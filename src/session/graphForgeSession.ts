import { tableFromIPC, type Table } from "apache-arrow";
import * as vscode from "vscode";
import { getNativeLoadError, loadGraphForgeModule } from "./nativeLoader";
import {
  discoverProjects,
  isGraphForgeProject,
  readManifestCapabilities,
  readWorkspaceOntology,
} from "./projectDetector";
import { randomOperationId } from "./uuid";
import {
  AlgorithmDescriptorContractNative,
  AnalystVerb,
  CheckpointViewNative,
  DetectedProject,
  EpistemicStatus,
  GraphEdge,
  GraphForgeNative,
  GraphNode,
  GraphPayload,
  InvocationDescriptorNative,
  KnowledgeSummary,
  OntologyDoc,
  ProjectCapabilities,
  QueryResult,
  TableRow,
  WriteMode,
} from "./types";

/** Raised when the loaded @graphforge/node binding predates a given method. */
export class UnsupportedByBindingError extends Error {
  constructor(methodName: string) {
    super(
      `This @graphforge/node binding does not expose \`${methodName}()\` yet. ` +
        "The engine API may still be moving — update the binding or check the method name.",
    );
    this.name = "UnsupportedByBindingError";
  }
}

export class GraphForgeSession implements vscode.Disposable {
  private forge: GraphForgeNative | undefined;
  private activeProject: DetectedProject | undefined;
  private activeWriteMode: WriteMode = "single_writer";
  private readonly statusBar: vscode.StatusBarItem;
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor() {
    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      50,
    );
    this.statusBar.command = "graphforge.showCapabilities";
    this.statusBar.show();
    this.refreshStatus();
  }

  dispose(): void {
    this._onDidChange.dispose();
    this.statusBar.dispose();
    this.forge = undefined;
  }

  get project(): DetectedProject | undefined {
    return this.activeProject;
  }

  get bindingAvailable(): boolean {
    return loadGraphForgeModule() !== null;
  }

  get bindingError(): string | undefined {
    loadGraphForgeModule();
    return getNativeLoadError();
  }

  async listProjects(): Promise<DetectedProject[]> {
    return discoverProjects();
  }

  async openProject(rootPath: string): Promise<void> {
    if (!isGraphForgeProject(rootPath)) {
      throw new Error(
        `Not a GraphForge project (missing or invalid FORMAT): ${rootPath}`,
      );
    }
    await this.attachForge(rootPath);
  }

  /**
   * Open `rootPath` via the engine's `open_or_initialize_project` contract:
   * an empty directory is initialized as the first committed generation, a
   * valid existing project is opened, and anything else (foreign/non-empty
   * unsafe dirs) fails closed with the engine's error code. Unlike
   * {@link openProject}, this does not pre-check for an existing FORMAT
   * marker, since initializing one is the point.
   */
  async initializeProject(rootPath: string): Promise<DetectedProject> {
    await this.attachForge(rootPath);
    return this.activeProject!;
  }

  /** Reopen the active project under a different write coordination policy (#11 / ADR 0015). */
  async reopenWithWriteMode(writeMode: WriteMode): Promise<void> {
    const project = this.activeProject ?? (await this.ensureProject());
    await this.attachForge(project.rootPath, writeMode);
  }

  /** Write coordination policy the active session was opened with (default `single_writer`). */
  get writeMode(): WriteMode {
    return this.activeWriteMode;
  }

  private async attachForge(
    rootPath: string,
    writeMode: WriteMode = "single_writer",
  ): Promise<void> {
    const mod = loadGraphForgeModule();
    if (!mod) {
      this.refreshStatus();
      throw new Error(getNativeLoadError() ?? "Native binding unavailable");
    }

    try {
      this.forge = new mod.GraphForge(rootPath, { writeMode });
    } catch (err) {
      // In-memory fallback attempt is not appropriate for project open; surface error.
      this.forge = undefined;
      throw err instanceof Error ? err : new Error(String(err));
    }
    this.activeWriteMode = writeMode;

    const projects = await discoverProjects();
    this.activeProject =
      projects.find((p) => p.rootPath === rootPath) ?? {
        rootPath,
        name: rootPath.split(/[\\/]/).pop() ?? rootPath,
      };

    this.refreshStatus();
    this._onDidChange.fire();
  }

  async ensureProject(): Promise<DetectedProject> {
    if (this.activeProject && this.forge) {
      return this.activeProject;
    }
    const projects = await this.listProjects();
    if (projects.length === 0) {
      throw new Error(
        "No GraphForge project found. Open a folder containing a FORMAT marker, or run GraphForge: Open Project.",
      );
    }
    await this.openProject(projects[0].rootPath);
    return this.activeProject!;
  }

  private requireForge(): GraphForgeNative {
    if (!this.forge) {
      throw new Error("No GraphForge session open. Run GraphForge: Open Project.");
    }
    return this.forge;
  }

  execute(cypher: string, params?: Record<string, unknown>): QueryResult {
    const forge = this.requireForge();
    const buf = params ? forge.execute(cypher, params) : forge.execute(cypher);
    return decodeTable(buf);
  }

  invokeVerb(
    verb: AnalystVerb,
    args: {
      label?: string;
      by?: string;
      via?: string;
      directed?: boolean;
      query?: string;
      k?: number;
      source?: string;
      target?: string;
    },
  ): QueryResult {
    const forge = this.requireForge();
    let buf: Buffer;
    switch (verb) {
      case "rank":
        buf = forge.rank(
          args.label ?? "",
          args.by ?? "pagerank",
          args.via,
          args.directed,
        );
        break;
      case "cluster":
        buf = forge.cluster(
          args.label ?? "",
          args.by ?? "louvain",
          args.via,
          args.directed,
        );
        break;
      case "paths":
        buf = forge.paths(
          args.source ?? null,
          args.target ?? null,
          args.by ?? "bfs",
          args.via,
          args.directed,
          args.k,
        );
        break;
      case "analyze":
        buf = forge.analyze(args.label, args.by ?? "spanning_tree", args.via, args.directed);
        break;
      case "similar":
        buf = forge.similar(args.label ?? "", args.by ?? "node_similarity", args.k);
        break;
      case "find":
        buf = forge.find(
          args.query,
          args.label,
          undefined,
          undefined,
          undefined,
          args.k ?? 10,
        );
        break;
      default:
        throw new Error(`Unknown verb: ${verb}`);
    }
    return decodeTable(buf);
  }

  labels(): string[] {
    try {
      return this.requireForge().labels();
    } catch {
      return [];
    }
  }

  relationshipTypes(): string[] {
    try {
      return this.requireForge().relationshipTypes();
    } catch {
      return [];
    }
  }

  ontologyMode(): string {
    try {
      return this.forge?.ontologyMode ?? "unknown";
    } catch {
      return "unknown";
    }
  }

  workspaceOntology(): OntologyDoc | undefined {
    if (!this.activeProject) {
      return undefined;
    }
    const ws = readWorkspaceOntology(
      this.activeProject.rootPath,
      this.activeProject.current?.generation_uuid,
    );
    return ws?.canonical_ontology;
  }

  capabilities(): ProjectCapabilities {
    if (!this.activeProject) {
      return { capabilities: [] };
    }
    return {
      capabilities: readManifestCapabilities(
        this.activeProject.rootPath,
        this.activeProject.current?.generation_uuid,
      ),
      generationUuid: this.activeProject.current?.generation_uuid,
    };
  }

  loadOntology(filePath: string): void {
    this.requireForge().loadOntology(filePath);
    this._onDidChange.fire();
  }

  // ======================================================================
  // Checkpoints (#9 / ADR 0014)
  // ======================================================================

  async createCheckpoint(name: string, description?: string): Promise<QueryResult> {
    const forge = this.requireForge();
    if (typeof forge.checkpoint !== "function") {
      throw new UnsupportedByBindingError("checkpoint");
    }
    const buf = await forge.checkpoint({
      name,
      description,
      idempotencyKey: randomOperationId(),
    });
    const result = decodeTable(buf);
    this._onDidChange.fire();
    return result;
  }

  async listCheckpoints(limit?: number, after?: string): Promise<QueryResult> {
    const forge = this.requireForge();
    if (typeof forge.listCheckpoints !== "function") {
      throw new UnsupportedByBindingError("listCheckpoints");
    }
    const buf = await forge.listCheckpoints({ limit, after });
    return decodeTable(buf);
  }

  /** Immutable, lease-pinned read handle over one named checkpoint. */
  openCheckpointView(name: string): CheckpointViewNative {
    const forge = this.requireForge();
    if (typeof forge.openCheckpoint !== "function") {
      throw new UnsupportedByBindingError("openCheckpoint");
    }
    return forge.openCheckpoint(name);
  }

  async deleteCheckpoint(name: string): Promise<QueryResult> {
    const forge = this.requireForge();
    if (typeof forge.deleteCheckpoint !== "function") {
      throw new UnsupportedByBindingError("deleteCheckpoint");
    }
    const buf = await forge.deleteCheckpoint({
      name,
      idempotencyKey: randomOperationId(),
    });
    const result = decodeTable(buf);
    this._onDidChange.fire();
    return result;
  }

  async diffCheckpoints(
    from: string,
    to: string,
    scope: string,
    detail: string,
  ): Promise<QueryResult> {
    const forge = this.requireForge();
    if (typeof forge.diffCheckpoints !== "function") {
      throw new UnsupportedByBindingError("diffCheckpoints");
    }
    const buf = await forge.diffCheckpoints({ from, to, scope, detail });
    return decodeTable(buf);
  }

  /** Restore a checkpoint as a new committed generation. Destructive — callers must hard-confirm. */
  async revertToCheckpoint(name: string, reason: string): Promise<QueryResult> {
    const forge = this.requireForge();
    if (typeof forge.revertToCheckpoint !== "function") {
      throw new UnsupportedByBindingError("revertToCheckpoint");
    }
    const buf = await forge.revertToCheckpoint({
      name,
      reason,
      idempotencyKey: randomOperationId(),
    });
    const result = decodeTable(buf);
    this._onDidChange.fire();
    return result;
  }

  // ======================================================================
  // Capabilities / write coordination (#11 / ADR 0015)
  // ======================================================================

  /** Live capability manifest from the open engine (distinct from the on-disk manifest read in {@link capabilities}). */
  async liveCapabilities(): Promise<QueryResult> {
    const forge = this.requireForge();
    if (typeof forge.projectCapabilities !== "function") {
      throw new UnsupportedByBindingError("projectCapabilities");
    }
    const buf = await forge.projectCapabilities();
    return decodeTable(buf);
  }

  async enableCapability(
    capabilityId: string,
    capabilityVersion: number,
    actorUuid?: string,
  ): Promise<QueryResult> {
    const forge = this.requireForge();
    if (typeof forge.enableCapability !== "function") {
      throw new UnsupportedByBindingError("enableCapability");
    }
    const buf = await forge.enableCapability({
      operationUuid: randomOperationId(),
      capabilityId,
      capabilityVersion,
      actorUuid,
    });
    const result = decodeTable(buf);
    this._onDidChange.fire();
    return result;
  }

  // ======================================================================
  // Embedding spaces (#10)
  // ======================================================================

  embeddingSpaces(): unknown[] {
    const forge = this.requireForge();
    if (typeof forge.embeddingSpaces !== "function") {
      throw new UnsupportedByBindingError("embeddingSpaces");
    }
    return forge.embeddingSpaces();
  }

  embeddingSpace(name?: string): unknown {
    const forge = this.requireForge();
    if (typeof forge.embeddingSpace !== "function") {
      throw new UnsupportedByBindingError("embeddingSpace");
    }
    return forge.embeddingSpace(name ?? null);
  }

  bindEmbeddingSpaceAlias(
    name: string,
    compatibilityId: string,
    replace?: boolean,
  ): unknown {
    const forge = this.requireForge();
    if (typeof forge.bindEmbeddingSpaceAlias !== "function") {
      throw new UnsupportedByBindingError("bindEmbeddingSpaceAlias");
    }
    const result = forge.bindEmbeddingSpaceAlias(name, compatibilityId, replace);
    this._onDidChange.fire();
    return result;
  }

  removeEmbeddingSpaceAlias(name: string): boolean {
    const forge = this.requireForge();
    if (typeof forge.removeEmbeddingSpaceAlias !== "function") {
      throw new UnsupportedByBindingError("removeEmbeddingSpaceAlias");
    }
    const removed = forge.removeEmbeddingSpaceAlias(name);
    this._onDidChange.fire();
    return removed;
  }

  setDefaultEmbeddingSpace(name?: string): unknown {
    const forge = this.requireForge();
    if (typeof forge.setDefaultEmbeddingSpace !== "function") {
      throw new UnsupportedByBindingError("setDefaultEmbeddingSpace");
    }
    const result = forge.setDefaultEmbeddingSpace(name ?? null);
    this._onDidChange.fire();
    return result;
  }

  deleteEmbeddingSpace(name?: string): boolean {
    const forge = this.requireForge();
    if (typeof forge.deleteEmbeddingSpace !== "function") {
      throw new UnsupportedByBindingError("deleteEmbeddingSpace");
    }
    const removed = forge.deleteEmbeddingSpace(name ?? null);
    this._onDidChange.fire();
    return removed;
  }

  publishCallerEmbeddings(
    name: string,
    input: {
      rows: Array<{ node: string; vector: number[] }>;
      dimensions: number;
      sourceProjection: Record<string, string>;
      replace?: boolean;
    },
  ): string {
    const forge = this.requireForge();
    if (typeof forge.publishCallerEmbeddings !== "function") {
      throw new UnsupportedByBindingError("publishCallerEmbeddings");
    }
    const id = forge.publishCallerEmbeddings(name, input);
    this._onDidChange.fire();
    return id;
  }

  inspectEmbeddingSpaceFreshness(name?: string, forceStale?: boolean): unknown {
    const forge = this.requireForge();
    if (typeof forge.inspectEmbeddingSpaceFreshness !== "function") {
      throw new UnsupportedByBindingError("inspectEmbeddingSpaceFreshness");
    }
    return forge.inspectEmbeddingSpaceFreshness(name ?? null, forceStale);
  }

  // ======================================================================
  // Find + index management (#8)
  // ======================================================================

  buildTextIndex(label: string, properties?: string[], rebuild?: boolean): unknown {
    const forge = this.requireForge();
    if (typeof forge.index !== "function") {
      throw new UnsupportedByBindingError("index");
    }
    const result = forge.index(label, {
      properties: properties?.length ? properties : null,
      rebuild,
    });
    this._onDidChange.fire();
    return result;
  }

  upsertVectorIndex(
    label: string,
    node: string,
    vector: number[],
    space?: string,
  ): unknown {
    const forge = this.requireForge();
    if (typeof forge.index !== "function") {
      throw new UnsupportedByBindingError("index");
    }
    const result = forge.index(label, { node, vector, space });
    this._onDidChange.fire();
    return result;
  }

  inspectTextIndex(label: string, properties?: string[]): unknown {
    const forge = this.requireForge();
    if (typeof forge.inspectTextIndex !== "function") {
      throw new UnsupportedByBindingError("inspectTextIndex");
    }
    return forge.inspectTextIndex(label, properties?.length ? properties : null);
  }

  buildAdjacencyIndex(): unknown {
    const forge = this.requireForge();
    if (typeof forge.indexAdjacency !== "function") {
      throw new UnsupportedByBindingError("indexAdjacency");
    }
    const result = forge.indexAdjacency();
    this._onDidChange.fire();
    return result;
  }

  inspectAdjacencyIndex(): unknown {
    const forge = this.requireForge();
    if (typeof forge.inspectAdjacency !== "function") {
      throw new UnsupportedByBindingError("inspectAdjacency");
    }
    return forge.inspectAdjacency();
  }

  rebuildAdjacencyIndex(): unknown {
    const forge = this.requireForge();
    if (typeof forge.rebuildAdjacency !== "function") {
      throw new UnsupportedByBindingError("rebuildAdjacency");
    }
    const result = forge.rebuildAdjacency();
    this._onDidChange.fire();
    return result;
  }

  // ======================================================================
  // Invocation descriptors / algorithm runs (#11)
  // ======================================================================

  algorithmDescriptorContracts(): AlgorithmDescriptorContractNative[] {
    const forge = this.requireForge();
    if (typeof forge.algorithmDescriptorContracts !== "function") {
      throw new UnsupportedByBindingError("algorithmDescriptorContracts");
    }
    return forge.algorithmDescriptorContracts();
  }

  /** Prepare (but do not execute) an invocation descriptor for one analyst verb path. */
  prepareInvocation(
    verb: Exclude<AnalystVerb, "find">,
    args: {
      label?: string;
      by: string;
      via?: string;
      directed?: boolean;
      k?: number;
      vectorProperty?: string;
      source?: string;
      target?: string;
    },
  ): InvocationDescriptorNative {
    const forge = this.requireForge();
    switch (verb) {
      case "rank":
        if (typeof forge.prepareRankInvocation !== "function") {
          throw new UnsupportedByBindingError("prepareRankInvocation");
        }
        return forge.prepareRankInvocation(args.label ?? "", args.by, args.via, args.directed);
      case "cluster":
        if (typeof forge.prepareClusterInvocation !== "function") {
          throw new UnsupportedByBindingError("prepareClusterInvocation");
        }
        return forge.prepareClusterInvocation(
          args.label ?? "",
          args.by,
          args.via,
          args.directed,
          args.vectorProperty,
        );
      case "paths":
        if (typeof forge.preparePathsInvocation !== "function") {
          throw new UnsupportedByBindingError("preparePathsInvocation");
        }
        return forge.preparePathsInvocation(
          args.source ?? null,
          args.target ?? null,
          args.by,
          args.via,
          args.directed,
          args.k,
        );
      case "analyze":
        if (typeof forge.prepareAnalyzeInvocation !== "function") {
          throw new UnsupportedByBindingError("prepareAnalyzeInvocation");
        }
        return forge.prepareAnalyzeInvocation(args.by, args.label, args.via, args.directed);
      case "similar":
        if (typeof forge.prepareSimilarInvocation !== "function") {
          throw new UnsupportedByBindingError("prepareSimilarInvocation");
        }
        return forge.prepareSimilarInvocation(
          args.label ?? "",
          args.by,
          args.k,
          args.vectorProperty,
          args.via,
        );
      default:
        throw new Error(`Unsupported descriptor verb: ${verb as string}`);
    }
  }

  invokeDescriptor(descriptor: InvocationDescriptorNative): QueryResult {
    const forge = this.requireForge();
    if (typeof forge.invokeDescriptor !== "function") {
      throw new UnsupportedByBindingError("invokeDescriptor");
    }
    const buf = forge.invokeDescriptor(descriptor);
    return decodeTable(buf);
  }

  async listAlgorithmRuns(algorithm?: string, limit?: number): Promise<QueryResult> {
    const forge = this.requireForge();
    if (typeof forge.listAlgorithmRuns !== "function") {
      throw new UnsupportedByBindingError("listAlgorithmRuns");
    }
    const buf = await forge.listAlgorithmRuns({ algorithm, limit });
    return decodeTable(buf);
  }

  async algorithmRun(runUuid: string): Promise<QueryResult> {
    const forge = this.requireForge();
    if (typeof forge.algorithmRun !== "function") {
      throw new UnsupportedByBindingError("algorithmRun");
    }
    const buf = await forge.algorithmRun(runUuid);
    return decodeTable(buf);
  }

  // ======================================================================
  // Composite transactions (#11, expert/Advanced-only)
  // ======================================================================

  publishCompositeTransaction(request: unknown): QueryResult {
    const forge = this.requireForge();
    if (typeof forge.publishCompositeTransaction !== "function") {
      throw new UnsupportedByBindingError("publishCompositeTransaction");
    }
    const buf = forge.publishCompositeTransaction(request);
    const result = decodeTable(buf);
    this._onDidChange.fire();
    return result;
  }

  knowledgeSummary(): KnowledgeSummary {
    if (!this.forge?.listAssertions) {
      return {
        assertionCount: 0,
        statusCounts: {},
        note: this.bindingAvailable
          ? "Knowledge ledger APIs not yet wired in this scaffold."
          : getNativeLoadError(),
      };
    }
    try {
      const result = decodeTable(this.forge.listAssertions());
      return {
        assertionCount: result.rowCount,
        statusCounts: {},
        note: "Assertion rows loaded; epistemic projection pending.",
      };
    } catch (err) {
      return {
        assertionCount: 0,
        statusCounts: {},
        note: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Build a graph payload from tabular results + optional epistemic/class tags. */
  toGraphPayload(result: QueryResult, title?: string): GraphPayload {
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const ontology = this.workspaceOntology();
    const entityNames = new Set(
      (ontology?.entity_types ?? []).map((e) => e.name),
    );

    for (const row of result.rows) {
      const uuid =
        stringField(row, "node_uuid") ??
        stringField(row, "id") ??
        stringField(row, "node1_uuid");
      const uuid2 = stringField(row, "node2_uuid");
      const labels = labelsFromRow(row);

      if (uuid) {
        const primary = labels[0];
        nodes.set(uuid, {
          id: uuid,
          labels: labels.length ? labels : ["Node"],
          properties: row,
          epistemicStatus: statusFromRow(row),
          ontologyType:
            primary && entityNames.has(primary) ? primary : primary,
        });
      }
      if (uuid2) {
        const labels2 = labelsFromRow(row, "node2");
        nodes.set(uuid2, {
          id: uuid2,
          labels: labels2.length ? labels2 : ["Node"],
          properties: { ...row, _side: "node2" },
          epistemicStatus: statusFromRow(row),
        });
        edges.push({
          id: `${uuid}-${uuid2}`,
          type: stringField(row, "rel_type") ?? "RELATED",
          source: uuid!,
          target: uuid2,
          epistemicStatus: statusFromRow(row),
        });
      }

      const source = stringField(row, "source") ?? stringField(row, "start_uuid");
      const target = stringField(row, "target") ?? stringField(row, "end_uuid");
      if (source && target) {
        if (!nodes.has(source)) {
          nodes.set(source, {
            id: source,
            labels: ["Node"],
            properties: {},
            epistemicStatus: "statusless",
          });
        }
        if (!nodes.has(target)) {
          nodes.set(target, {
            id: target,
            labels: ["Node"],
            properties: {},
            epistemicStatus: "statusless",
          });
        }
        edges.push({
          id: stringField(row, "edge_uuid") ?? `${source}->${target}`,
          type: stringField(row, "type") ?? stringField(row, "rel_type") ?? "RELATED",
          source,
          target,
          epistemicStatus: statusFromRow(row),
          properties: row,
        });
      }
    }

    // Scaffold demo graph when result has no graph-shaped columns
    if (nodes.size === 0) {
      return demoGraphPayload(title ?? "Result (demo)", result);
    }

    const types = [
      ...new Set(
        [...nodes.values()]
          .map((n) => n.ontologyType ?? n.labels[0])
          .filter(Boolean) as string[],
      ),
    ];

    return {
      nodes: [...nodes.values()],
      edges,
      legend: {
        statuses: [
          "hypothesis",
          "supported",
          "refuted",
          "disputed",
          "retracted",
          "superseded",
          "statusless",
        ],
        types,
      },
      title,
    };
  }

  notifyChanged(): void {
    this._onDidChange.fire();
    this.refreshStatus();
  }

  private refreshStatus(): void {
    if (!this.bindingAvailable) {
      this.statusBar.text = "$(warning) GraphForge: binding missing";
      this.statusBar.tooltip = getNativeLoadError();
      return;
    }
    if (!this.activeProject) {
      this.statusBar.text = "$(database) GraphForge";
      this.statusBar.tooltip = "No project open";
      return;
    }
    const mode = this.ontologyMode();
    this.statusBar.text = `$(database) GraphForge: ${this.activeProject.name} (${mode})`;
    this.statusBar.tooltip = this.activeProject.rootPath;
  }
}

function decodeTable(buf: Buffer): QueryResult {
  const table = tableFromIPC(buf) as Table;
  const columns = table.schema.fields.map((f) => f.name);
  const rows: TableRow[] = [];
  for (let i = 0; i < table.numRows; i++) {
    const row: TableRow = {};
    for (const col of columns) {
      const child = table.getChild(col);
      row[col] = normalizeCell(child?.get(i));
    }
    rows.push(row);
  }
  const algorithm = table.schema.metadata?.get("graphforge.algorithm");
  return {
    columns,
    rows,
    rowCount: table.numRows,
    algorithm: algorithm ?? undefined,
  };
}

function normalizeCell(value: unknown): unknown {
  if (value == null) {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return bufferToUuid(value) ?? value.toString("hex");
  }
  if (value instanceof Uint8Array) {
    return bufferToUuid(Buffer.from(value)) ?? Buffer.from(value).toString("hex");
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
}

function bufferToUuid(buf: Buffer): string | undefined {
  if (buf.length !== 16) {
    return undefined;
  }
  const hex = buf.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stringField(row: TableRow, key: string): string | undefined {
  const v = row[key];
  if (v == null) {
    return undefined;
  }
  return String(v);
}

function labelsFromRow(row: TableRow, prefix = ""): string[] {
  const key = prefix ? `${prefix}_label` : "label";
  const labelsKey = prefix ? `${prefix}_labels` : "labels";
  const label = stringField(row, key);
  if (label) {
    return [label];
  }
  const labels = row[labelsKey];
  if (Array.isArray(labels)) {
    return labels.map(String);
  }
  if (typeof labels === "string") {
    return [labels];
  }
  return [];
}

function statusFromRow(row: TableRow): EpistemicStatus {
  const raw = stringField(row, "epistemic_status") ?? stringField(row, "status");
  const allowed: EpistemicStatus[] = [
    "hypothesis",
    "supported",
    "refuted",
    "disputed",
    "retracted",
    "superseded",
    "statusless",
  ];
  if (raw && (allowed as string[]).includes(raw)) {
    return raw as EpistemicStatus;
  }
  return "statusless";
}

function demoGraphPayload(title: string, result: QueryResult): GraphPayload {
  const nodes: GraphNode[] = [
    {
      id: "demo-a",
      labels: ["Person"],
      ontologyType: "Person",
      epistemicStatus: "supported",
      properties: { name: "Alice", note: "scaffold demo" },
    },
    {
      id: "demo-b",
      labels: ["Person"],
      ontologyType: "Person",
      epistemicStatus: "hypothesis",
      properties: { name: "Bob", note: "scaffold demo" },
    },
    {
      id: "demo-c",
      labels: ["Org"],
      ontologyType: "Org",
      epistemicStatus: "disputed",
      properties: { name: "Curate", rows: result.rowCount },
    },
  ];
  const edges: GraphEdge[] = [
    {
      id: "e1",
      type: "KNOWS",
      source: "demo-a",
      target: "demo-b",
      epistemicStatus: "supported",
    },
    {
      id: "e2",
      type: "WORKS_AT",
      source: "demo-a",
      target: "demo-c",
      epistemicStatus: "hypothesis",
    },
  ];
  return {
    nodes,
    edges,
    legend: {
      statuses: [
        "hypothesis",
        "supported",
        "refuted",
        "disputed",
        "retracted",
        "superseded",
        "statusless",
      ],
      types: ["Person", "Org"],
    },
    title,
  };
}
