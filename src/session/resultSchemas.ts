import type {
  ResultField,
  ResultFieldType,
  ResultProvenance,
  ResultSchema,
} from "./types";

/**
 * GraphForge result-schema coverage ledger (#80).
 *
 * GraphForge Core owns computation and canonical Arrow schemas; this module
 * owns only *result-to-visualization intent*: for every registered result
 * schema it records how the extension may present it. It never computes
 * layouts, joins results onto a base graph, or reduces embeddings — those
 * compositions belong to XYG.
 *
 * Dispositions:
 * - `entity-graph`: Cypher node/edge/path entities with persisted identity.
 * - `node-layer`: UUID-keyed node values (scores, communities, order, colors).
 * - `edge-layer`: persisted edges identified by `edge_uuid` with endpoints.
 * - `derived-edges`: analytical node pairs (similarity, flow, closure) that are
 *   visibly distinct from persisted relationships.
 * - `ordered-paths`: ordered UUID lists (paths, walks, cycles, trails).
 * - `table-only`: scalar/global/category results; never forced into a graph.
 * - `composition-required`: needs an explicit base graph or coordinates
 *   (embeddings, edge colors without endpoints) before it can be drawn.
 *
 * Source: CurateLabs/graphforge `crates/graphforge-core/src/algorithms.rs`
 * (`result_schema`/`path_schema`/`analyze_schema`) at algorithm schema v1.
 */
export type ResultDisposition =
  | "entity-graph"
  | "node-layer"
  | "edge-layer"
  | "derived-edges"
  | "ordered-paths"
  | "table-only"
  | "composition-required";

export type ResultFieldRole =
  | "node"
  | "edge"
  | "source"
  | "target"
  | "node-path"
  | "edge-path"
  | "metric"
  | "order"
  | "rank"
  | "cost"
  | "group"
  | "vector"
  | "category";

type FieldKind = ResultFieldType["kind"];

export interface ResultFieldSpec {
  name: string;
  kinds: readonly FieldKind[];
  role: ResultFieldRole;
}

export interface ResultSchemaEntry {
  /** Stable extension-side id for the canonical schema shape. */
  id: string;
  version: number;
  disposition: ResultDisposition;
  /** Fixed leading fields; rank/cluster/find append nullable node properties. */
  fields: readonly ResultFieldSpec[];
  algorithms: readonly string[];
  /** Relationship type shown for derived edges / path steps. */
  derivedEdgeType?: string;
  /** Why this disposition was chosen (shown for table-only/composition-required). */
  note: string;
}

export type ResultSchemaErrorCode =
  | "GF_RESULT_SCHEMA_UNREGISTERED"
  | "GF_RESULT_SCHEMA_VERSION"
  | "GF_RESULT_SCHEMA_MISMATCH"
  | "GF_RESULT_NO_IDENTITY"
  | "GF_RESULT_TABLE_ONLY"
  | "GF_RESULT_COMPOSITION_REQUIRED"
  | "GF_PROJECTION_STALE_SOURCE";

export interface ResultSchemaError {
  code: ResultSchemaErrorCode;
  message: string;
  nextAction: string;
}

export const SUPPORTED_ALGORITHM_SCHEMA_VERSION = 1;
export const SUPPORTED_SEARCH_SCHEMA_VERSION = 1;

const UUID = ["uuid"] as const;
const UUID_LIST = ["uuid-list"] as const;
const FLOAT = ["float"] as const;
const INT = ["int"] as const;
const BOOL = ["bool"] as const;
const UTF8 = ["utf8"] as const;

function field(name: string, kinds: readonly FieldKind[], role: ResultFieldRole): ResultFieldSpec {
  return { name, kinds, role };
}

const EDGE_ENDPOINTS = [
  field("edge_uuid", UUID, "edge"),
  field("source_uuid", UUID, "source"),
  field("target_uuid", UUID, "target"),
];

function scalar(
  id: string,
  algorithms: string[],
  fields: ResultFieldSpec[],
  note = "Global structural result; shown as a table rather than forced into a graph.",
): ResultSchemaEntry {
  return { id, version: 1, disposition: "table-only", fields, algorithms, note };
}

/** Every stable GraphForge algorithm result schema, keyed by shape. */
export const ALGORITHM_RESULT_SCHEMAS: readonly ResultSchemaEntry[] = [
  {
    id: "node-score",
    version: 1,
    disposition: "node-layer",
    fields: [field("node_uuid", UUID, "node"), field("score", FLOAT, "metric")],
    algorithms: [
      "pagerank", "betweenness", "closeness", "harmonic_closeness", "degree",
      "eigenvector", "article_rank", "hits_hub", "hits_authority", "celf",
      "clustering_coefficient", "local_clustering_coefficient", "triangles",
      "k_core", "preferential_attachment", "adamic_adar", "common_neighbors",
      "resource_allocation", "total_neighbors",
    ],
    note: "Node scores keyed by node_uuid.",
  },
  {
    id: "node-community",
    version: 1,
    disposition: "node-layer",
    fields: [field("node_uuid", UUID, "node"), field("community_id", INT, "group")],
    algorithms: [
      "louvain", "leiden", "label_propagation", "speaker_listener",
      "girvan_newman", "modularity_optimization", "fastgreedy", "infomap",
      "leading_eigenvector", "walktrap", "spinglass", "hdbscan", "k_means",
      "approximate_max_k_cut", "components", "strongly_connected",
      "biconnected", "k_core_decomposition",
    ],
    note: "Community membership keyed by node_uuid.",
  },
  {
    id: "similarity",
    version: 1,
    disposition: "derived-edges",
    fields: [
      field("node1_uuid", UUID, "source"),
      field("node2_uuid", UUID, "target"),
      field("similarity", FLOAT, "metric"),
    ],
    algorithms: ["node_similarity", "knn", "filtered_knn", "filtered_node_similarity", "cosine"],
    derivedEdgeType: "SIMILAR",
    note: "Similarity pairs are derived edges, not persisted relationships.",
  },
  {
    id: "path",
    version: 1,
    disposition: "ordered-paths",
    fields: [
      field("source_uuid", UUID, "source"),
      field("target_uuid", UUID, "target"),
      field("cost", FLOAT, "cost"),
      field("path", UUID_LIST, "node-path"),
    ],
    algorithms: [
      "bfs", "dijkstra", "dijkstra_all_pairs", "astar", "bellman_ford",
      "floyd_warshall", "delta_stepping",
    ],
    derivedEdgeType: "PATH_STEP",
    note: "Ordered node paths with cost.",
  },
  {
    id: "ranked-path",
    version: 1,
    disposition: "ordered-paths",
    fields: [
      field("source_uuid", UUID, "source"),
      field("target_uuid", UUID, "target"),
      field("rank", INT, "rank"),
      field("cost", FLOAT, "cost"),
      field("path", UUID_LIST, "node-path"),
    ],
    algorithms: ["yens"],
    derivedEdgeType: "PATH_STEP",
    note: "k ranked node paths with cost.",
  },
  {
    id: "traversal",
    version: 1,
    disposition: "node-layer",
    fields: [
      field("node_uuid", UUID, "node"),
      field("depth", INT, "metric"),
      field("order", INT, "order"),
    ],
    algorithms: ["dfs"],
    note: "Visit order and depth keyed by node_uuid.",
  },
  {
    id: "walk",
    version: 1,
    disposition: "ordered-paths",
    fields: [field("start_uuid", UUID, "source"), field("walk", UUID_LIST, "node-path")],
    algorithms: ["random_walk"],
    derivedEdgeType: "WALK_STEP",
    note: "Ordered random walks.",
  },
  {
    id: "pair",
    version: 1,
    disposition: "derived-edges",
    fields: [field("source_uuid", UUID, "source"), field("target_uuid", UUID, "target")],
    algorithms: ["transitive_closure"],
    derivedEdgeType: "REACHES",
    note: "Reachability pairs are derived edges.",
  },
  {
    id: "flow",
    version: 1,
    disposition: "derived-edges",
    fields: [
      field("source_uuid", UUID, "source"),
      field("sink_uuid", UUID, "target"),
      field("flow", FLOAT, "metric"),
    ],
    algorithms: ["max_flow"],
    derivedEdgeType: "MAX_FLOW",
    note: "Source/sink flow value as a derived pair.",
  },
  {
    id: "costed-flow",
    version: 1,
    disposition: "derived-edges",
    fields: [
      field("source_uuid", UUID, "source"),
      field("sink_uuid", UUID, "target"),
      field("flow", FLOAT, "metric"),
      field("cost", FLOAT, "cost"),
    ],
    algorithms: ["min_cost_max_flow"],
    derivedEdgeType: "MIN_COST_FLOW",
    note: "Source/sink flow and cost as a derived pair.",
  },
  {
    id: "min-cut",
    version: 1,
    disposition: "derived-edges",
    fields: [
      field("source_uuid", UUID, "source"),
      field("sink_uuid", UUID, "target"),
      field("cut_value", FLOAT, "metric"),
    ],
    algorithms: ["min_cut"],
    derivedEdgeType: "MIN_CUT",
    note: "Source/sink cut value as a derived pair.",
  },
  {
    id: "cut-tree",
    version: 1,
    disposition: "derived-edges",
    fields: [
      field("source_uuid", UUID, "source"),
      field("target_uuid", UUID, "target"),
      field("cut_value", FLOAT, "metric"),
    ],
    algorithms: ["gomory_hu_tree"],
    derivedEdgeType: "CUT_TREE",
    note: "Gomory-Hu tree edges are derived (no persisted edge_uuid).",
  },
  {
    id: "flow-edges",
    version: 1,
    disposition: "edge-layer",
    fields: [...EDGE_ENDPOINTS, field("flow", FLOAT, "metric")],
    algorithms: ["max_flow_edges"],
    note: "Per-edge flow keyed by edge_uuid.",
  },
  {
    id: "costed-flow-edges",
    version: 1,
    disposition: "edge-layer",
    fields: [
      ...EDGE_ENDPOINTS,
      field("flow", FLOAT, "metric"),
      field("unit_cost", FLOAT, "cost"),
      field("flow_cost", FLOAT, "cost"),
    ],
    algorithms: ["min_cost_max_flow_edges"],
    note: "Per-edge flow and cost keyed by edge_uuid.",
  },
  {
    id: "min-cut-edges",
    version: 1,
    disposition: "edge-layer",
    fields: [...EDGE_ENDPOINTS, field("capacity", FLOAT, "metric")],
    algorithms: ["min_cut_edges"],
    note: "Cut edges keyed by edge_uuid.",
  },
  {
    id: "steiner-edge-list",
    version: 1,
    disposition: "edge-layer",
    fields: [...EDGE_ENDPOINTS, field("weight", FLOAT, "metric")],
    algorithms: ["min_steiner_tree", "prize_collecting_steiner_tree"],
    note: "Steiner tree edges keyed by edge_uuid.",
  },
  {
    id: "edge-list",
    version: 1,
    disposition: "edge-layer",
    fields: [...EDGE_ENDPOINTS, field("weight", FLOAT, "metric")],
    algorithms: ["minimum_spanning_tree", "maximum_spanning_tree", "max_weight_matching"],
    note: "Tree/matching edges keyed by edge_uuid.",
  },
  {
    id: "unweighted-edge-list",
    version: 1,
    disposition: "edge-layer",
    fields: EDGE_ENDPOINTS,
    algorithms: ["max_cardinality_matching", "max_bipartite_matching", "bridges"],
    note: "Matching/bridge edges keyed by edge_uuid.",
  },
  {
    id: "k-edge-list",
    version: 1,
    disposition: "edge-layer",
    fields: [field("tree_id", INT, "group"), ...EDGE_ENDPOINTS, field("weight", FLOAT, "metric")],
    algorithms: ["minimum_k_spanning_tree"],
    note: "Grouped spanning-tree edges keyed by edge_uuid.",
  },
  {
    id: "node-order",
    version: 1,
    disposition: "node-layer",
    fields: [field("node_uuid", UUID, "node"), field("order", INT, "order")],
    algorithms: ["topological_sort"],
    note: "Topological order keyed by node_uuid.",
  },
  {
    id: "node",
    version: 1,
    disposition: "node-layer",
    fields: [field("node_uuid", UUID, "node")],
    algorithms: ["articulation_points"],
    note: "Node set keyed by node_uuid.",
  },
  {
    id: "node-color",
    version: 1,
    disposition: "node-layer",
    fields: [field("node_uuid", UUID, "node"), field("color", INT, "group")],
    algorithms: ["node_coloring", "k1_coloring"],
    note: "Node coloring keyed by node_uuid.",
  },
  {
    id: "edge-color",
    version: 1,
    disposition: "composition-required",
    fields: [field("edge_uuid", UUID, "edge"), field("color", INT, "group")],
    algorithms: ["edge_coloring"],
    note: "Edge colors carry no endpoints; compose them onto a base graph result to draw them.",
  },
  {
    id: "euler-trail",
    version: 1,
    disposition: "ordered-paths",
    fields: [field("node_path", UUID_LIST, "node-path"), field("edge_path", UUID_LIST, "edge-path")],
    algorithms: ["euler_circuit", "euler_path"],
    note: "Ordered Euler trail over persisted edges.",
  },
  {
    id: "cycle",
    version: 1,
    disposition: "ordered-paths",
    fields: [field("cycle", UUID_LIST, "node-path")],
    algorithms: ["find_cycles"],
    derivedEdgeType: "CYCLE_STEP",
    note: "One ordered cycle per row.",
  },
  {
    id: "cost-path",
    version: 1,
    disposition: "ordered-paths",
    fields: [field("cost", FLOAT, "cost"), field("path", UUID_LIST, "node-path")],
    algorithms: ["dag_longest_path", "dag_longest_path_weighted"],
    derivedEdgeType: "PATH_STEP",
    note: "Ordered longest path with cost.",
  },
  scalar("is-dag", ["is_dag"], [field("is_dag", BOOL, "metric")]),
  scalar("has-euler-circuit", ["has_euler_circuit"], [field("has_euler_circuit", BOOL, "metric")]),
  scalar("has-euler-path", ["has_euler_path"], [field("has_euler_path", BOOL, "metric")]),
  scalar("is-planar", ["is_planar"], [field("is_planar", BOOL, "metric")]),
  scalar("chromatic-number", ["chromatic_number"], [field("chromatic_number", INT, "metric")]),
  scalar("triangle-count", ["triangle_count"], [field("triangle_count", INT, "metric")]),
  scalar("automorphism-count", ["count_automorphisms"], [field("count", INT, "metric")]),
  scalar("modularity", ["modularity"], [field("modularity", FLOAT, "metric")]),
  scalar("transitivity", ["transitivity"], [field("transitivity", FLOAT, "metric")]),
  scalar(
    "conductance",
    ["conductance"],
    [field("partition_id", UTF8, "category"), field("conductance", FLOAT, "metric")],
    "Per-partition conductance; partition ids are property values, not node identities.",
  ),
  scalar(
    "triad-census",
    ["triad_census"],
    [field("triad_type", UTF8, "category"), field("count", INT, "metric")],
    "Category counts; shown as a table.",
  ),
  scalar(
    "dyad-census",
    ["dyad_census"],
    [field("dyad_type", UTF8, "category"), field("count", INT, "metric")],
    "Category counts; shown as a table.",
  ),
  {
    id: "embedding",
    version: 1,
    disposition: "composition-required",
    fields: [field("node_uuid", UUID, "node"), field("embedding", ["float-vector"], "vector")],
    algorithms: ["node2vec", "graphsage", "fast_random_projection", "hashgnn"],
    note: "Embeddings need caller-provided 2D coordinates or an explicit dimensional view; dimensions are never plotted as x/y.",
  },
];

/** `find` search results: node_uuid + node properties + score + matched_on. */
export const SEARCH_RESULT_SCHEMA: ResultSchemaEntry = {
  id: "search",
  version: 1,
  disposition: "node-layer",
  fields: [
    field("node_uuid", UUID, "node"),
    field("score", FLOAT, "metric"),
    field("matched_on", UTF8, "category"),
  ],
  algorithms: [],
  note: "Search hits keyed by node_uuid.",
};

/** Cypher results carrying node/edge/path entity structs or canonical UUID columns. */
export const CYPHER_ENTITY_SCHEMA: ResultSchemaEntry = {
  id: "cypher-entities",
  version: 1,
  disposition: "entity-graph",
  fields: [],
  algorithms: [],
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
  fields: [],
  algorithms: [],
  note: "Scalar identity columns projected by the query author.",
};

export const TABULAR_SCHEMA: ResultSchemaEntry = {
  id: "tabular",
  version: 1,
  disposition: "table-only",
  fields: [],
  algorithms: [],
  note: "No graph identity columns; shown as a table.",
};

const ALGORITHM_INDEX = new Map<string, ResultSchemaEntry>();
for (const entry of ALGORITHM_RESULT_SCHEMAS) {
  for (const algorithm of entry.algorithms) {
    ALGORITHM_INDEX.set(algorithm, entry);
  }
}

export function resultSchemaForAlgorithm(algorithm: string): ResultSchemaEntry | undefined {
  return ALGORITHM_INDEX.get(algorithm);
}

export interface ResultClassification {
  entry: ResultSchemaEntry;
  verb?: string;
  algorithm?: string;
  /** Present when the result cannot be drawn; the table remains available. */
  error?: ResultSchemaError;
}

const ALGORITHM_VERBS = new Set(["rank", "cluster", "similar", "paths", "analyze"]);

function describeFieldType(type: ResultFieldType): string {
  return type.kind;
}

function checkFields(
  entry: ResultSchemaEntry,
  fields: readonly ResultField[],
): ResultSchemaError | undefined {
  const byName = new Map(fields.map((f) => [f.name, f]));
  for (const spec of entry.fields) {
    const actual = byName.get(spec.name);
    if (!actual) {
      return {
        code: "GF_RESULT_SCHEMA_MISMATCH",
        message: `Result is missing the canonical "${spec.name}" field for the ${entry.id} schema.`,
        nextAction: "Re-run the algorithm with a GraphForge engine that matches this extension's schema ledger.",
      };
    }
    if (!spec.kinds.includes(actual.type.kind)) {
      return {
        code: "GF_RESULT_SCHEMA_MISMATCH",
        message: `Field "${spec.name}" is ${describeFieldType(actual.type)}; the ${entry.id} schema expects ${spec.kinds.join(" or ")}.`,
        nextAction: "Re-run the algorithm with a GraphForge engine that matches this extension's schema ledger.",
      };
    }
  }
  return undefined;
}

function dispositionError(entry: ResultSchemaEntry): ResultSchemaError | undefined {
  if (entry.disposition === "table-only") {
    return {
      code: "GF_RESULT_TABLE_ONLY",
      message: `${entry.id} results are table-only: ${entry.note}`,
      nextAction: "Use the Results table or a chart visualization for this result.",
    };
  }
  if (entry.disposition === "composition-required") {
    return {
      code: "GF_RESULT_COMPOSITION_REQUIRED",
      message: `${entry.id} results need an explicit composition: ${entry.note}`,
      nextAction: "Keep this result in the Results table until an explicit composition is available.",
    };
  }
  return undefined;
}

function isEntityStruct(type: ResultFieldType): boolean {
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
 * Classify a result by its preserved Arrow schema. Algorithm results are
 * matched by `graphforge.algorithm` against the ledger and their canonical
 * field types are verified; nothing is inferred from values.
 */
export function classifyResult(
  columns: readonly string[],
  schema: ResultSchema | undefined,
): ResultClassification {
  const metadata = schema?.metadata ?? {};
  const verb = metadata["graphforge.verb"];
  const algorithm = metadata["graphforge.algorithm"];

  if (schema && verb && ALGORITHM_VERBS.has(verb)) {
    const version = Number(metadata["graphforge.algorithm_schema_version"]);
    const entry = algorithm ? resultSchemaForAlgorithm(algorithm) : undefined;
    if (!entry) {
      return {
        entry: TABULAR_SCHEMA,
        verb,
        algorithm,
        error: {
          code: "GF_RESULT_SCHEMA_UNREGISTERED",
          message: `No visualization disposition is registered for the "${algorithm ?? "unknown"}" ${verb} result.`,
          nextAction: "Update GraphForge for VS Code, or use the Results table for this result.",
        },
      };
    }
    if (version !== entry.version || version !== SUPPORTED_ALGORITHM_SCHEMA_VERSION) {
      return {
        entry,
        verb,
        algorithm,
        error: {
          code: "GF_RESULT_SCHEMA_VERSION",
          message: `Algorithm result schema version ${Number.isFinite(version) ? version : "(missing)"} is not supported (expected ${entry.version}).`,
          nextAction: "Use a GraphForge engine and extension release with matching result schema versions.",
        },
      };
    }
    const mismatch = checkFields(entry, schema.fields);
    return {
      entry,
      verb,
      algorithm,
      error: mismatch ?? dispositionError(entry),
    };
  }

  if (schema && verb === "find") {
    const version = Number(metadata["graphforge.search_schema_version"]);
    if (version !== SUPPORTED_SEARCH_SCHEMA_VERSION) {
      return {
        entry: SEARCH_RESULT_SCHEMA,
        verb,
        error: {
          code: "GF_RESULT_SCHEMA_VERSION",
          message: `Search result schema version ${Number.isFinite(version) ? version : "(missing)"} is not supported (expected ${SUPPORTED_SEARCH_SCHEMA_VERSION}).`,
          nextAction: "Use a GraphForge engine and extension release with matching result schema versions.",
        },
      };
    }
    return {
      entry: SEARCH_RESULT_SCHEMA,
      verb,
      error: checkFields(SEARCH_RESULT_SCHEMA, schema.fields),
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
  for (const key of ["generationUuid", "queryId"] as const) {
    const item = record[key];
    if (item === undefined) continue;
    if (typeof item !== "string") {
      throw new Error(`Result provenance ${key} must be a string: ${source}`);
    }
    provenance[key] = item;
  }
  return provenance;
}
