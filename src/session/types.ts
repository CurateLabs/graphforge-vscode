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

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
  legend: {
    statuses: EpistemicStatus[];
    types: string[];
  };
  title?: string;
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

/** Minimal surface we expect from @graphforge/node GraphForge. */
export interface GraphForgeNative {
  path: string | null;
  ontologyMode: string;
  execute(cypher: string, params?: Record<string, unknown>): Buffer;
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
  listAssertions?(request?: unknown): Buffer;
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
