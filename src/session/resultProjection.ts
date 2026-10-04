import { stringField } from "./arrowCodec";
import {
  classifyResult,
  type ResultClassification,
  type ResultSchemaErrorCode,
} from "./resultSchemas";
import {
  isEpistemicStatus,
  type EpistemicStatus,
  type GraphEdge,
  type GraphNode,
  type GraphProjectionSource,
  type QueryResult,
  type ResultFieldType,
  type ResultProjectionDiagnostic,
  type ResultRowEntities,
  type TableRow,
} from "./types";

/** Upper bound on projected nodes + edges before the graph is refused. */
export const MAX_PROJECTED_ENTITIES = 250_000;

export class ResultProjectionError extends Error {
  constructor(
    readonly code: ResultSchemaErrorCode | "GF_RESULT_TOO_LARGE",
    message: string,
    readonly nextAction: string,
  ) {
    super(`${message} ${nextAction}`);
    this.name = "ResultProjectionError";
  }
}

export interface ResultGraphProjection {
  classification: ResultClassification;
  nodes: GraphNode[];
  edges: GraphEdge[];
  rowEntities: ResultRowEntities[];
  source: GraphProjectionSource;
  diagnostic: ResultProjectionDiagnostic;
}

class GraphBuilder {
  readonly nodes = new Map<string, GraphNode>();
  readonly edges = new Map<string, GraphEdge>();
  rowNodes = new Set<string>();
  rowEdges = new Set<string>();

  constructor(private readonly limit: number) {}

  node(id: string, labels?: string[], properties?: TableRow, status?: EpistemicStatus): void {
    this.rowNodes.add(id);
    const existing = this.nodes.get(id);
    if (existing) {
      if (labels?.length && existing.labels[0] === "Node") {
        existing.labels = labels;
        existing.ontologyType = labels[0];
      }
      if (properties) existing.properties = { ...existing.properties, ...properties };
      return;
    }
    this.guard();
    const resolved = labels?.length ? labels : ["Node"];
    const node: GraphNode = {
      id,
      labels: resolved,
      properties: properties ?? {},
      ontologyType: labels?.length ? labels[0] : undefined,
    };
    if (status) node.epistemicStatus = status;
    this.nodes.set(id, node);
  }

  edge(edge: GraphEdge): void {
    this.node(edge.source);
    this.node(edge.target);
    this.rowEdges.add(edge.id);
    if (this.edges.has(edge.id)) return;
    this.guard();
    this.edges.set(edge.id, edge);
  }

  takeRow(): ResultRowEntities {
    const row = { nodeIds: [...this.rowNodes], edgeIds: [...this.rowEdges] };
    this.rowNodes = new Set();
    this.rowEdges = new Set();
    return row;
  }

  private guard(): void {
    if (this.nodes.size + this.edges.size >= this.limit) {
      throw new ResultProjectionError(
        "GF_RESULT_TOO_LARGE",
        `The result projects to more than ${this.limit} graph entities.`,
        "Add a LIMIT or filter the result, then open the graph again.",
      );
    }
  }
}

function uuidOf(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}


function labelsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v) => v != null).map(String);
  if (typeof value === "string" && value) return [value];
  return [];
}

function withoutNulls(record: TableRow, omit: readonly string[]): TableRow {
  const out: TableRow = {};
  for (const [key, value] of Object.entries(record)) {
    if (value != null && !omit.includes(key)) out[key] = value;
  }
  return out;
}

function statusFromRow(row: TableRow): EpistemicStatus | undefined {
  const raw = stringField(row, "epistemic_status") ?? stringField(row, "status");
  return isEpistemicStatus(raw) ? raw : undefined;
}

// Cypher entity structs -------------------------------------------------------

function visitEntity(builder: GraphBuilder, value: unknown, type: ResultFieldType): void {
  if (value == null) return;
  if (type.kind === "list") {
    if (Array.isArray(value)) {
      for (const item of value) visitEntity(builder, item, type.item);
    }
    return;
  }
  if (type.kind !== "struct" || typeof value !== "object") return;
  const record = value as TableRow;
  const names = new Set(type.fields.map((f) => f.name));

  if (names.has("nodes") && names.has("relationships")) {
    for (const f of type.fields) {
      if (f.name === "nodes" || f.name === "relationships") {
        visitEntity(builder, record[f.name], f.type);
      }
    }
    return;
  }
  const edgeId = uuidOf(record.edge_uuid);
  const src = uuidOf(record.src_uuid);
  const dst = uuidOf(record.dst_uuid);
  if (edgeId && src && dst) {
    builder.edge({
      id: edgeId,
      type: stringField(record, "rel_type") ?? "RELATED",
      source: src,
      target: dst,
      properties: withoutNulls(record, ["edge_uuid", "src_uuid", "dst_uuid", "rel_type"]),
    });
    return;
  }
  const nodeId = uuidOf(record.node_uuid);
  if (nodeId) {
    builder.node(
      nodeId,
      labelsOf(record.labels),
      withoutNulls(record, ["node_uuid", "labels"]),
    );
  }
}

function projectEntities(builder: GraphBuilder, result: QueryResult): ResultRowEntities[] {
  const fields = result.schema?.fields ?? [];
  return result.rows.map((row) => {
    for (const f of fields) visitEntity(builder, row[f.name], f.type);
    return builder.takeRow();
  });
}

// Scalar identity columns -----------------------------------------------------

const SOURCE_COLUMNS = ["source_uuid", "src_uuid", "source", "start_uuid"];
const TARGET_COLUMNS = ["target_uuid", "dst_uuid", "target", "end_uuid"];

function firstField(row: TableRow, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = stringField(row, key);
    if (value) return value;
  }
  return undefined;
}

function labelsFromRow(row: TableRow): string[] {
  const label = stringField(row, "label");
  return label ? [label] : labelsOf(row.labels);
}

function projectColumns(builder: GraphBuilder, result: QueryResult): ResultRowEntities[] {
  return result.rows.map((row) => {
    const status = statusFromRow(row);
    const nodeId = stringField(row, "node_uuid") ?? stringField(row, "id");
    if (nodeId) builder.node(nodeId, labelsFromRow(row), row, status);
    const source = firstField(row, SOURCE_COLUMNS);
    const target = firstField(row, TARGET_COLUMNS);
    if (source && target) {
      const edge: GraphEdge = {
        id: stringField(row, "edge_uuid") ?? `${source}->${target}`,
        type: stringField(row, "type") ?? stringField(row, "rel_type") ?? "RELATED",
        source,
        target,
        properties: row,
      };
      if (status) edge.epistemicStatus = status;
      builder.edge(edge);
    }
    return builder.takeRow();
  });
}

/**
 * Project a result into graph geometry inputs by schema, not by guessing.
 * Every node/edge id is a GraphForge UUID (or, for derived path steps, a
 * result-scoped step id), and `rowEntities` maps each result row to the
 * identities it contributed so selection round-trips by identity.
 *
 * Throws `ResultProjectionError` with a stable code and next action when the
 * result is table-only, needs an explicit composition, or fails validation.
 */
export function projectResultGraph(
  result: QueryResult,
  options: { maxEntities?: number } = {},
): ResultGraphProjection {
  const started = performance.now();
  const classification = classifyResult(result.columns, result.schema);
  if (classification.error) {
    const { code, message, nextAction } = classification.error;
    throw new ResultProjectionError(code, message, nextAction);
  }
  const builder = new GraphBuilder(options.maxEntities ?? MAX_PROJECTED_ENTITIES);
  const { entry } = classification;
  const rowEntities =
    entry.id === "cypher-entities"
      ? projectEntities(builder, result)
      : projectColumns(builder, result);

  const source: GraphProjectionSource = {
    schemaId: entry.id,
    schemaVersion: entry.version,
    disposition: entry.disposition,
  };
  if (result.provenance?.resultId) source.resultId = result.provenance.resultId;
  if (result.provenance?.generationUuid) {
    source.generationUuid = result.provenance.generationUuid;
  }
  const nodes = [...builder.nodes.values()];
  const edges = [...builder.edges.values()];
  return {
    classification,
    nodes,
    edges,
    rowEntities,
    source,
    diagnostic: {
      schemaId: entry.id,
      schemaVersion: entry.version,
      disposition: entry.disposition,
      rows: result.rows.length,
      nodes: nodes.length,
      edges: edges.length,
      durationMs: Math.round((performance.now() - started) * 100) / 100,
    },
  };
}

/**
 * Whether `result` can open a view automatically: Cypher graphs, or XYG
 * layers (XYG then draws only a `graph` intent and skips the rest).
 */
export function isGraphProjectable(result: QueryResult): boolean {
  const classification = classifyResult(result.columns, result.schema);
  return classification.error === undefined || classification.entry.id === "xyg-layer";
}

/**
 * Fail when a projection is joined with a result from another source or
 * graph generation. Both sides must carry identity for the join to be safe.
 */
export function sourceMismatch(
  projection: GraphProjectionSource | undefined,
  result: QueryResult,
): string | undefined {
  const resultId = result.provenance?.resultId;
  if (!projection?.resultId && !resultId) return undefined;
  if (projection?.resultId !== resultId) {
    return "The graph shows a different result than this table.";
  }
  const generation = result.provenance?.generationUuid;
  if (projection?.generationUuid && generation && projection.generationUuid !== generation) {
    return "The graph was projected from a different graph generation.";
  }
  return undefined;
}
