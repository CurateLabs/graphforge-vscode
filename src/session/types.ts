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
  /** True once the underlying `@graphforge/node` binding exposes the knowledge API at all. */
  capabilityAvailable: boolean;
  assertionCount: number;
  statusCounts: Partial<Record<EpistemicStatus, number>>;
  assertions: AssertionRow[];
  note?: string;
}

export interface AssertionRow {
  assertionUuid: string;
  claim: string;
  [key: string]: unknown;
}

export type AssertionGraphKind = "node" | "edge";
export type AssertionGraphRole = "subject" | "object" | "context";
export type ExplicitAssertionStatus = Exclude<EpistemicStatus, "statusless">;
export type EvidenceSourceKind = "document" | "observation" | "graph_node" | "graph_edge";
export type EvidenceRole = "supports" | "contradicts" | "context";
export type ConfidencePolicy = "explicit" | "conservative_min";

export interface AssertionGraphRefInput {
  graphUuid: string;
  graphKind: AssertionGraphKind;
  role: AssertionGraphRole;
  ordinal: number;
}

export interface CreateAssertionInput {
  operationUuid: string;
  assertionUuid: string;
  claim: string;
  graphRefs: AssertionGraphRefInput[];
  actorUuid?: string;
}

export interface ListAssertionsInput {
  graphUuid?: string;
  limit?: number;
  after?: string;
}

export interface AttachEvidenceInput {
  operationUuid: string;
  evidenceUuid: string;
  assertionUuid: string;
  sourceUuid: string;
  sourceKind: EvidenceSourceKind;
  role: EvidenceRole;
  weight?: number;
  actorUuid?: string;
}

export interface AssessConfidenceInput {
  operationUuid: string;
  confidenceUuid: string;
  assertionUuid: string;
  policy: ConfidencePolicy;
  value?: number;
  inputConfidenceUuids?: string[];
  actorUuid?: string;
}

export interface RecordAssertionStatusInput {
  operationUuid: string;
  statusEventUuid: string;
  assertionUuid: string;
  status: ExplicitAssertionStatus;
  provenanceUuid: string;
  confidenceUuid?: string;
  reasoningUuid?: string;
  actorUuid?: string;
}

export interface ListAssertionStatusInput {
  assertionUuid?: string;
  limit?: number;
  after?: string;
}

export interface ProjectCapabilities {
  capabilities: string[];
  generationUuid?: string;
  raw?: unknown;
}

/** Write coordination policy for a project session (ADR 0015). */
export type WriteMode = "single_writer" | "queued_writer" | "optimistic_multi_writer";

export const WRITE_MODES: readonly WriteMode[] = [
  "single_writer",
  "queued_writer",
  "optimistic_multi_writer",
];

/** Read-only handle over one pinned checkpoint generation (v0.5 `CheckpointView`). */
export interface CheckpointViewNative {
  readonly checkpointUuid: string;
  readonly generationUuid: string;
  execute(cypher: string): Buffer;
  projectCapabilities(): Buffer;
  inspectAdjacency(): unknown;
}

/** Opaque canonical M18 invocation descriptor handle (ADR contract). */
export interface InvocationDescriptorNative {
  readonly canonicalBytes: Buffer;
  readonly fingerprint: string;
  readonly projectionFingerprint: string;
  readonly verb: string;
  readonly algorithm: string;
}

export interface AlgorithmDescriptorContractNative {
  verb: string;
  algorithm: string;
  algorithmVersion: number;
  resultSchemaVersion: number;
}

/** Minimal surface we expect from @graphforge/node GraphForge. */
export interface GraphForgeNative {
  path: string | null;
  ontologyMode: string;
  execute(cypher: string, params?: Record<string, unknown>): Buffer;

  // ---- Checkpoints (#9 / ADR 0014) — every op is async (Promise<Buffer>). ----
  checkpoint?(request: {
    name: string;
    description?: string | null;
    idempotencyKey: string;
    actorUuid?: string | null;
  }): Promise<Buffer>;
  listCheckpoints?(request?: {
    limit?: number;
    after?: string | null;
  }): Promise<Buffer>;
  openCheckpoint?(name: string): CheckpointViewNative;
  deleteCheckpoint?(request: {
    name: string;
    idempotencyKey: string;
    actorUuid?: string | null;
  }): Promise<Buffer>;
  diffCheckpoints?(request: {
    from: string;
    to: string;
    scope: string;
    detail: string;
    limit?: number;
    after?: string | null;
  }): Promise<Buffer>;
  revertToCheckpoint?(request: {
    name: string;
    reason: string;
    idempotencyKey: string;
    actorUuid?: string | null;
  }): Promise<Buffer>;

  // ---- Capabilities / write coordination (#11 / ADR 0015). ----
  projectCapabilities?(): Promise<Buffer>;
  enableCapability?(request: {
    operationUuid: string;
    capabilityId: string;
    capabilityVersion: number;
    actorUuid?: string | null;
  }): Promise<Buffer>;

  // ---- Embedding spaces (#10). ----
  embeddingSpaces?(): unknown[];
  embeddingSpace?(name?: string | null): unknown;
  bindEmbeddingSpaceAlias?(
    name: string,
    compatibilityId: string,
    replace?: boolean,
  ): unknown;
  removeEmbeddingSpaceAlias?(name: string): boolean;
  setDefaultEmbeddingSpace?(name?: string | null): unknown;
  deleteEmbeddingSpace?(name?: string | null): boolean;
  publishCallerEmbeddings?(
    name: string,
    input: {
      rows: Array<{ node: string; vector: number[] }>;
      dimensions: number;
      sourceProjection: Record<string, string>;
      normalization?: "none" | "l2";
      replace?: boolean;
    },
  ): string;
  inspectEmbeddingSpaceFreshness?(
    name?: string | null,
    forceStale?: boolean,
  ): unknown;
  embeddingRefreshProjectPolicy?(): unknown;

  // ---- Find + indexing (#8). ----
  index?(
    label: string,
    input?: {
      properties?: string[] | null;
      rebuild?: boolean;
      node?: string | null;
      vector?: number[] | null;
      space?: string | null;
    } | null,
  ): unknown;
  inspectTextIndex?(label: string, properties?: string[] | null): unknown;
  indexAdjacency?(): unknown;
  inspectAdjacency?(): unknown;
  rebuildAdjacency?(): unknown;

  // ---- Invocation descriptors / algorithm runs (#11). ----
  algorithmDescriptorContracts?(): AlgorithmDescriptorContractNative[];
  prepareRankInvocation?(
    label: string,
    by: string,
    via?: string | null,
    directed?: boolean | null,
  ): InvocationDescriptorNative;
  prepareClusterInvocation?(
    label: string,
    by: string,
    via?: string | null,
    directed?: boolean | null,
    vectorProperty?: string | null,
  ): InvocationDescriptorNative;
  preparePathsInvocation?(
    source: unknown,
    target: unknown,
    by: string,
    via?: string | null,
    directed?: boolean | null,
    k?: number | null,
  ): InvocationDescriptorNative;
  prepareAnalyzeInvocation?(
    by: string,
    label?: string | null,
    via?: string | null,
    directed?: boolean | null,
  ): InvocationDescriptorNative;
  prepareSimilarInvocation?(
    label: string,
    by: string,
    k?: number | null,
    vectorProperty?: string | null,
    via?: string | null,
  ): InvocationDescriptorNative;
  invokeDescriptor?(descriptor: InvocationDescriptorNative): Buffer;
  listAlgorithmRuns?(request?: {
    algorithm?: string | null;
    limit?: number;
    after?: string | null;
  }): Promise<Buffer>;
  algorithmRun?(runUuid: string): Promise<Buffer>;

  // ---- Composite transactions (#11, expert/Advanced-only). ----
  publishCompositeTransaction?(request: unknown): Buffer;

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
    vector?: number[] | null,
    similarTo?: unknown,
    semanticQuery?: string | null,
    limit?: number | null,
    space?: string | null,
    forceStale?: boolean | null,
  ): Buffer;
  labels(): string[];
  relationshipTypes(): string[];
  loadOntology(path: string): void;
  /**
   * Knowledge ledger surface. Optional and defensively typed: the sibling
   * `@graphforge/node` binding is a separate, moving project and these methods
   * may be absent, renamed, or return a Promise instead of a Buffer (they are
   * currently async `AsyncTask`s on the Node side). Always feature-detect with
   * `typeof forge.xxx === "function"` before calling and resolve the return
   * value through `resolveIpcBuffer`.
   */
  listAssertions?(request?: unknown): Buffer | Promise<Buffer>;
  assertion?(assertionUuid: string): Buffer | Promise<Buffer>;
  assertionGraphRefs?(assertionUuid: string, request?: unknown): Buffer | Promise<Buffer>;
  createAssertion?(request: unknown): Buffer | Promise<Buffer>;
  attachEvidence?(request: unknown): Buffer | Promise<Buffer>;
  assessConfidence?(request: unknown): Buffer | Promise<Buffer>;
  recordAssertionStatus?(request: unknown): Buffer | Promise<Buffer>;
  listAssertionStatus?(request?: unknown): Buffer | Promise<Buffer>;
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
