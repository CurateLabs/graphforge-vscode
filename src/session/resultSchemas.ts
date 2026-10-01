import type {
  ResultField,
  ResultFieldType,
  ResultProvenance,
  ResultSchema,
} from "./types";
import { isXygResultLayer } from "./xygAdapter";

/**
 * Result routing for visualization (#80).
 *
 * GraphForge Core owns computation and canonical Arrow schemas. XYG's Rust
 * ledger owns recognition, dispositions, joins, and composition for every
 * GraphForge algorithm and `find` result (`graphforgeLedger()`; agreed with
 * docs/engineering/RESULT_SCHEMAS.md by XYG's tests). This module therefore
 * keeps no algorithm registry: it only decides *which host* draws a result.
 *
 * - `xyg-layer`: algorithm and `find` results, recognized from engine metadata
 *   and composed by XYG over a base graph read at the same generation.
 * - `cypher-entities`: Cypher node/relationship/path values (UUID structs).
 * - `cypher-columns`: scalar identity columns written by the query author.
 * - `tabular`: no graph identity; shown as a table.
 *
 * Cypher graphs stay on the Result Graph renderer until XYG composes a base
 * graph without a result layer (its compose request requires one) and #82
 * retires the previous renderers.
 */
export type ResultDisposition = "xyg-layer" | "entity-graph" | "table-only";

export interface ResultSchemaEntry {
  /** Stable extension-side id for the route. */
  id: string;
  version: number;
  disposition: ResultDisposition;
  note: string;
}

export type ResultSchemaErrorCode =
  | "GF_RESULT_XYG_LAYER"
  | "GF_RESULT_NO_IDENTITY"
  | "GF_PROJECTION_STALE_SOURCE";

export interface ResultSchemaError {
  code: ResultSchemaErrorCode;
  message: string;
  nextAction: string;
}

/** Algorithm and `find` results: XYG recognizes and composes them in Rust. */
export const XYG_LAYER_SCHEMA: ResultSchemaEntry = {
  id: "xyg-layer",
  version: 1,
  disposition: "xyg-layer",
  note: "GraphForge algorithm/find result composed by XYG.",
};

/** Cypher results carrying node/edge/path entity structs. */
export const CYPHER_ENTITY_SCHEMA: ResultSchemaEntry = {
  id: "cypher-entities",
  version: 1,
  disposition: "entity-graph",
  note: "Cypher node/relationship/path values with persisted UUID identity.",
};

/**
 * Cypher (or saved, untyped) tables whose scalar columns explicitly name graph
 * identity: `node_uuid`/`id` for nodes and `source`/`target` (or canonical
 * `src_uuid`/`dst_uuid`, `source_uuid`/`target_uuid`) for edges.
 */
export const CYPHER_COLUMNS_SCHEMA: ResultSchemaEntry = {
  id: "cypher-columns",
  version: 1,
  disposition: "entity-graph",
  note: "Scalar identity columns projected by the query author.",
};

export const TABULAR_SCHEMA: ResultSchemaEntry = {
  id: "tabular",
  version: 1,
  disposition: "table-only",
  note: "No graph identity columns; shown as a table.",
};

export interface ResultClassification {
  entry: ResultSchemaEntry;
  verb?: string;
  algorithm?: string;
  /** Present when the Result Graph renderer cannot draw the result. */
  error?: ResultSchemaError;
}

function isEntityStruct(type: ResultFieldType): boolean {
  if (type.kind === "list") return isEntityStruct(type.item);
  if (type.kind !== "struct") return false;
  const names = new Set(type.fields.map((f) => f.name));
  return (
    names.has("node_uuid") ||
    names.has("edge_uuid") ||
    (names.has("nodes") && names.has("relationships"))
  );
}

const CANONICAL_UUID_COLUMNS = new Set([
  "node_uuid",
  "edge_uuid",
  "src_uuid",
  "dst_uuid",
  "source_uuid",
  "target_uuid",
]);

function hasColumns(columns: readonly string[], ...names: string[]): boolean {
  return names.every((name) => columns.includes(name));
}

/** True when scalar columns explicitly name node or edge identity. */
export function hasIdentityColumns(columns: readonly string[]): boolean {
  return (
    columns.some((c) => CANONICAL_UUID_COLUMNS.has(c)) ||
    columns.includes("id") ||
    hasColumns(columns, "source", "target") ||
    hasColumns(columns, "start_uuid", "end_uuid")
  );
}

/**
 * Route a result by its preserved Arrow schema. Algorithm/`find` results go
 * to XYG (from `graphforge.verb`, never from column names); Cypher entity
 * values and author-written identity columns go to the Result Graph.
 */
export function classifyResult(
  columns: readonly string[],
  schema: ResultSchema | undefined,
): ResultClassification {
  const metadata = schema?.metadata;
  if (isXygResultLayer(metadata)) {
    return {
      entry: XYG_LAYER_SCHEMA,
      verb: metadata?.["graphforge.verb"],
      algorithm: metadata?.["graphforge.algorithm"],
      error: {
        code: "GF_RESULT_XYG_LAYER",
        message: "GraphForge algorithm and search results are composed by XYG.",
        nextAction: "Run GraphForge: Visualize Result to open it in XYG.",
      },
    };
  }
  if (schema?.fields.some((f) => isEntityStruct(f.type))) {
    return { entry: CYPHER_ENTITY_SCHEMA };
  }
  if (hasIdentityColumns(columns)) {
    return { entry: CYPHER_COLUMNS_SCHEMA };
  }
  return {
    entry: TABULAR_SCHEMA,
    error: {
      code: "GF_RESULT_NO_IDENTITY",
      message: "This result has no node or relationship identity to draw as a graph.",
      nextAction: "Return nodes/relationships (e.g. RETURN n, r, m) or node_uuid / source + target columns, or use a chart visualization.",
    },
  };
}

// Persisted schema/provenance validation -------------------------------------

const SIMPLE_KINDS = new Set(["uuid", "uuid-list", "utf8", "bool", "float", "date", "binary"]);

function isRecordOfStrings(value: unknown): value is Record<string, string> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function parseFieldType(value: unknown, depth: number): ResultFieldType | undefined {
  if (!value || typeof value !== "object" || depth > 8) return undefined;
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  if (typeof kind !== "string") return undefined;
  if (SIMPLE_KINDS.has(kind)) return { kind } as ResultFieldType;
  switch (kind) {
    case "float-vector":
      return typeof record.dimensions === "number"
        ? { kind, dimensions: record.dimensions }
        : { kind };
    case "int":
      return typeof record.bits === "number" && typeof record.signed === "boolean"
        ? { kind, bits: record.bits, signed: record.signed }
        : undefined;
    case "timestamp":
      return typeof record.timezone === "string" ? { kind, timezone: record.timezone } : { kind };
    case "list": {
      const item = parseFieldType(record.item, depth + 1);
      return item ? { kind, item } : undefined;
    }
    case "struct": {
      if (!Array.isArray(record.fields)) return undefined;
      const fields = record.fields.map((f) => parseField(f, depth + 1));
      return fields.every((f): f is ResultField => f !== undefined) ? { kind, fields } : undefined;
    }
    case "other":
      return typeof record.arrowType === "string" ? { kind, arrowType: record.arrowType } : undefined;
    default:
      return undefined;
  }
}

function parseField(value: unknown, depth: number): ResultField | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const type = parseFieldType(record.type, depth);
  if (typeof record.name !== "string" || typeof record.nullable !== "boolean" || !type) {
    return undefined;
  }
  const field: ResultField = { name: record.name, type, nullable: record.nullable };
  if (record.metadata !== undefined) {
    if (!isRecordOfStrings(record.metadata)) return undefined;
    field.metadata = record.metadata;
  }
  return field;
}

/** Validate a persisted `ResultSchema`; throws on malformed input. */
export function parseResultSchema(value: unknown, source: string): ResultSchema {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  if (!record || !Array.isArray(record.fields) || !isRecordOfStrings(record.metadata)) {
    throw new Error(`Result schema must have fields and string metadata: ${source}`);
  }
  const fields = record.fields.map((f) => parseField(f, 0));
  if (!fields.every((f): f is ResultField => f !== undefined)) {
    throw new Error(`Result schema has an invalid field: ${source}`);
  }
  return { fields, metadata: record.metadata };
}

/** Validate persisted result provenance; throws on malformed input. */
export function parseResultProvenance(value: unknown, source: string): ResultProvenance {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  if (!record || typeof record.resultId !== "string" || !record.resultId) {
    throw new Error(`Result provenance requires a resultId: ${source}`);
  }
  const provenance: ResultProvenance = { resultId: record.resultId };
  for (const key of ["generationUuid", "queryId", "ipcSha256"] as const) {
    const item = record[key];
    if (item === undefined) continue;
    if (typeof item !== "string") {
      throw new Error(`Result provenance ${key} must be a string: ${source}`);
    }
    provenance[key] = item;
  }
  return provenance;
}
