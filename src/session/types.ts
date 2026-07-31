/** Exact FORMAT marker bytes from gf-storage PROJECT_FORMAT_BYTES. */
export const PROJECT_FORMAT_BYTES = Buffer.from("graphforge-project/v1\n", "utf8");
export const FORMAT_FILE = "FORMAT";
export const CURRENT_FILE = "CURRENT";

export type EpistemicStatus =
  | "hypothesis"
  | "supported"
  | "refuted"
  | "disputed"
  | "retracted"
  | "superseded"
  | "statusless";

export type OntologyMode = "exploratory" | "advisory" | "strict" | "none" | string;

export interface CurrentPointer {
  format: string;
  format_version: number;
  generation_uuid: string;
  generation_manifest_sha256?: string;
}

export interface DetectedProject {
  rootPath: string;
  name: string;
  current?: CurrentPointer;
}

export interface TableRow {
  [key: string]: unknown;
}

export interface QueryResult {
  columns: string[];
  rows: TableRow[];
  rowCount: number;
  algorithm?: string;
}

export interface GraphNode {
  id: string;
  labels: string[];
  properties: TableRow;
  epistemicStatus?: EpistemicStatus;
  ontologyType?: string;
}

export interface GraphEdge {
  id: string;
  type: string;
  source: string;
  target: string;
  epistemicStatus?: EpistemicStatus;
  properties?: TableRow;
}

/**
 * How the Result Graph should render node/edge color:
 * - "epistemic": real ledger-resolved statuses are present (may include
 *   legitimate "statusless" values).
 * - "class-only": no knowledge capability (or binding support) — color by
 *   ontology/label class only. Never invent a status in this mode.
 * - "demo": scaffold sample data shown when there are no graph-shaped rows.
 */
export type GraphStyleMode = "epistemic" | "class-only" | "demo";

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
  legend: {
    statuses: EpistemicStatus[];
    types: string[];
  };
  title?: string;
  styleMode: GraphStyleMode;
  /** Human-readable note shown in the webview header (e.g. why styling fell back). */
  banner?: string;
}

export interface OntologyEntityType {
  name: string;
  abstract?: boolean;
  parent?: string;
}

export interface OntologyRelationType {
  name: string;
  src: string;
  dst: string;
  inverse?: string;
}

export interface OntologyProperty {
  owner: string;
  name: string;
  type: string;
  nullable?: boolean;
}

export interface OntologyDoc {
  ontology_id?: string;
  version?: string | number;
  entity_types?: OntologyEntityType[];
  relation_types?: OntologyRelationType[];
  properties?: OntologyProperty[];
}

export interface WorkspaceOntology {
  contract_version?: number;
  mode?: string;
  source_format?: string | null;
  canonical_ontology?: OntologyDoc;
}

export interface KnowledgeSummary {
  assertionCount: number;
  statusCounts: Partial<Record<EpistemicStatus, number>>;
  note?: string;
}

export interface ProjectCapabilities {
  capabilities: string[];
  generationUuid?: string;
  raw?: unknown;
}

/** One live M18 algorithm descriptor contract (`algorithmDescriptorContracts()`). */
export interface AlgorithmDescriptorContract {
  verb: string;
  algorithm: string;
  algorithmVersion: number;
  resultSchemaVersion: number;
}

/** Advanced belief-resolution controls (GraphForge: Result Graph (Advanced)…). */
export interface BeliefPolicySettings {
  /** Attempt ledger status resolution at all when the knowledge capability exists. */
  enabled: boolean;
  /** Bound on how many result-graph node UUIDs get resolved per render. */
  maxNodes: number;
}

export const DEFAULT_BELIEF_POLICY: BeliefPolicySettings = {
  enabled: true,
  maxNodes: 40,
};

/** Minimal surface we expect from @graphforge/node GraphForge. */
export interface GraphForgeNative {
  path: string | null;
  ontologyMode: string;
  execute(cypher: string, params?: Record<string, unknown>): Buffer;
  /** Live M18 descriptor catalog, deterministic order (sync; requires open project). */
  algorithmDescriptorContracts?(): AlgorithmDescriptorContract[];
  rank(
    label: string,
    by: string,
    via?: string | null,
    directed?: boolean | null,
    writeProperty?: string | null,
  ): Buffer;
  cluster(
    label: string,
    by: string,
    via?: string | null,
    directed?: boolean | null,
    writeProperty?: string | null,
    vectorProperty?: string | null,
  ): Buffer;
  paths(
    source: unknown,
    target: unknown,
    by: string,
    via?: string | null,
    directed?: boolean | null,
    k?: number | null,
  ): Buffer;
  analyze(
    label: string | null | undefined,
    by: string,
    via?: string | null,
    directed?: boolean | null,
  ): Buffer;
  similar(
    label: string,
    by: string,
    k?: number | null,
    vectorProperty?: string | null,
    via?: string | null,
  ): Buffer;
  find(
    query?: string | null,
    label?: string | null,
    limit?: number | null,
  ): Buffer;
  labels(): string[];
  relationshipTypes(): string[];
  loadOntology(path: string): void;
  /** Page of assertions, optionally filtered to one graph object (node/edge) UUID. Async. */
  listAssertions?(request?: {
    graphUuid?: string;
    limit?: number;
    after?: string;
  }): Promise<Buffer>;
  /** Current explicit status for one assertion, or an empty table when statusless. Async. */
  assertionStatus?(assertionUuid: string): Promise<Buffer>;
}

export interface GraphForgeModule {
  GraphForge: new (
    path?: string,
    options?: { writeMode?: string },
  ) => GraphForgeNative;
  version?: () => string;
}

export type AnalystVerb = "rank" | "cluster" | "paths" | "analyze" | "similar" | "find";

export const RANK_BY = [
  "pagerank",
  "betweenness",
  "closeness",
  "degree",
  "eigenvector",
  "article_rank",
  "hits_hub",
  "hits_authority",
  "clustering_coefficient",
  "triangles",
  "k_core",
] as const;

export const CLUSTER_BY = [
  "louvain",
  "leiden",
  "label_propagation",
  "components",
  "strongly_connected",
  "k_means",
  "hdbscan",
] as const;

export const PATHS_BY = [
  "bfs",
  "dijkstra",
  "astar",
  "shortest_path",
] as const;

export const ANALYZE_BY = [
  "node2vec",
  "spanning_tree",
  "dag_longest_path",
  "node_coloring",
  "is_planar",
] as const;

export const SIMILAR_BY = [
  "node_similarity",
  "knn",
  "cosine",
] as const;

/** Static fallback catalogs, used only when `algorithmDescriptorContracts()` is unavailable. */
export const FALLBACK_BY: Record<Exclude<AnalystVerb, "find">, readonly string[]> = {
  rank: RANK_BY,
  cluster: CLUSTER_BY,
  paths: PATHS_BY,
  analyze: ANALYZE_BY,
  similar: SIMILAR_BY,
};
