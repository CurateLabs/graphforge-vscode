import * as vscode from "vscode";
import { decodeTable, resolveIpcBuffer, stringField } from "./arrowCodec";
import { NodeOnlyFeatureError, UnsupportedByBindingError } from "./errors";
import { aggregateStatusCounts } from "./knowledgeStatus";
import { NodeEngineBackend } from "./nodeEngineBackend";
import {
  discoverProjects,
  isGraphForgeProject,
  readManifestCapabilities,
  readWorkspaceOntology,
} from "./projectDetector";
import { detectWorkspaceProjectKind, type ProjectKind } from "./projectKindDetector";
import {
  chooseRuntime,
  describeRuntimeUnavailable,
  nodeBindingStatus,
  type NodeBindingStatus,
  openEngineBackend,
  pythonRuntimeStatus,
  runtimePreference,
} from "./runtime";
import { randomOperationId, uuidv7 } from "./uuid";
import {
  AlgorithmDescriptorContract,
  AlgorithmDescriptorContractNative,
  AnalystVerb,
  AssertionRow,
  AssessConfidenceInput,
  AttachEvidenceInput,
  BeliefPolicySettings,
  CheckpointViewNative,
  CreateAssertionInput,
  DEFAULT_BELIEF_POLICY,
  DetectedProject,
  EngineBackend,
  EpistemicStatus,
  FALLBACK_BY,
  GraphEdge,
  GraphForgeNative,
  GraphNode,
  GraphPayload,
  GraphStyleMode,
  InvocationDescriptorNative,
  KnowledgeSummary,
  ListAssertionsInput,
  ListAssertionStatusInput,
  OntologyDoc,
  ProjectCapabilities,
  PythonRuntimeStatus,
  QueryResult,
  RecordAssertionStatusInput,
  RuntimeKind,
  RuntimePreference,
  TableRow,
  WriteMode,
} from "./types";

/** Live catalog for one verb, or the static fallback with a UI-visible reason. */
export interface AlgorithmCatalog {
  items: string[];
  source: "contracts" | "fallback";
  note?: string;
}

export interface RuntimeEnvironmentSnapshot {
  preference: RuntimePreference;
  node: NodeBindingStatus;
  python: PythonRuntimeStatus;
  /** What kind of workspace this looks like (Python-first, Node-ish, or ambiguous); see `projectKind.ts`. */
  projectKind: ProjectKind;
  /** Runtime actually backing the open session, if any. */
  active: RuntimeKind | undefined;
}

const ALL_EPISTEMIC_STATUSES: EpistemicStatus[] = [
  "hypothesis",
  "supported",
  "refuted",
  "disputed",
  "retracted",
  "superseded",
  "statusless",
];

function isEpistemicStatus(value: unknown): value is EpistemicStatus {
  return typeof value === "string" && (ALL_EPISTEMIC_STATUSES as string[]).includes(value);
}

// Defined in `errors.ts` (vscode-free) so error-presentation logic can be
// unit tested under plain mocha; re-exported here for existing import sites.
export { NodeOnlyFeatureError, UnsupportedByBindingError } from "./errors";

export class GraphForgeSession implements vscode.Disposable {
  private backend: EngineBackend | undefined;
  private activeProject: DetectedProject | undefined;
  private activeWriteMode: WriteMode = "single_writer";
  private algorithmContractsCache: AlgorithmDescriptorContract[] | undefined;
  private lastResult: QueryResult | undefined;
  private lastResultTitle: string | undefined;
  private beliefPolicy: BeliefPolicySettings = { ...DEFAULT_BELIEF_POLICY };
  private readonly statusBar: vscode.StatusBarItem;
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor() {
    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      50,
    );
    this.statusBar.command = "graphforge.statusBarClick";
    this.statusBar.show();
    this.refreshStatus();
  }

  dispose(): void {
    this._onDidChange.dispose();
    this.statusBar.dispose();
    void this.backend?.dispose();
    this.backend = undefined;
  }

  get project(): DetectedProject | undefined {
    return this.activeProject;
  }

  /** Runtime actually backing the open session, if any (#12). */
  get activeRuntime(): RuntimeKind | undefined {
    return this.backend?.runtime;
  }

  /**
   * Legacy Node-specific status (issue #2 Setup Native Binding surface).
   * Prefer {@link environmentSnapshot} for runtime-agnostic reporting (#12).
   */
  get bindingAvailable(): boolean {
    return nodeBindingStatus().available;
  }

  get bindingError(): string | undefined {
    return nodeBindingStatus().error;
  }

  /** True when the configured `graphforge.runtime` preference can resolve to a usable backend. */
  async hasUsableRuntime(): Promise<boolean> {
    const snapshot = await this.environmentSnapshot();
    return (
      chooseRuntime(snapshot.preference, snapshot.node, snapshot.python, snapshot.projectKind) !== undefined
    );
  }

  /** Full Node + Python runtime status for Check Environment (#12) and status bar. */
  async environmentSnapshot(): Promise<RuntimeEnvironmentSnapshot> {
    const preference = runtimePreference();
    const node = nodeBindingStatus();
    const python = await pythonRuntimeStatus();
    const projectKind = await detectWorkspaceProjectKind(vscode.workspace.workspaceFolders, python.available);
    return { preference, node, python, projectKind, active: this.backend?.runtime };
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
    await this.attachBackend(rootPath);
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
    await this.attachBackend(rootPath);
    return this.activeProject!;
  }

  /**
   * Reopen the active project under a different write coordination policy
   * (#11 / ADR 0015). Node-only concept — reopening under the Python runtime
   * always resolves to `single_writer` since the bridge has no equivalent
   * write-coordination surface yet.
   */
  async reopenWithWriteMode(writeMode: WriteMode): Promise<void> {
    const project = this.activeProject ?? (await this.ensureProject());
    await this.attachBackend(project.rootPath, writeMode);
  }

  /** Write coordination policy the active session was opened with (default `single_writer`; Node-only, #11 / ADR 0015). */
  get writeMode(): WriteMode {
    return this.activeWriteMode;
  }

  private async attachBackend(
    rootPath: string,
    writeMode: WriteMode = "single_writer",
  ): Promise<void> {
    let backend: EngineBackend;
    try {
      backend = await openEngineBackend(rootPath, writeMode);
    } catch (err) {
      this.refreshStatus();
      throw err instanceof Error ? err : new Error(String(err));
    }

    const previous = this.backend;
    this.backend = backend;
    if (previous) {
      void previous.dispose();
    }

    this.algorithmContractsCache = undefined;
    this.lastResult = undefined;
    this.lastResultTitle = undefined;
    // Write-mode coordination is Node-only; a Python-backed session always
    // reports the (only meaningful) single-writer default.
    this.activeWriteMode = backend.runtime === "node" ? writeMode : "single_writer";

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
    if (this.activeProject && this.backend) {
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

  private requireBackend(): EngineBackend {
    if (!this.backend) {
      throw new Error("No GraphForge session open. Run GraphForge: Open Project.");
    }
    return this.backend;
  }

  /**
   * Escape hatch to the full `@curatelabs/graphforge` surface for advanced
   * Node-only features. Throws {@link NodeOnlyFeatureError} when the active
   * backend is not Node (e.g. the Python runtime is active, #12).
   */
  private requireNodeForge(methodName: string): GraphForgeNative {
    const backend = this.requireBackend();
    if (!(backend instanceof NodeEngineBackend)) {
      throw new NodeOnlyFeatureError(methodName);
    }
    return backend.native;
  }

  async execute(cypher: string, params?: Record<string, unknown>): Promise<QueryResult> {
    const backend = this.requireBackend();
    const buf = await backend.execute(cypher, params);
    return decodeTable(buf);
  }

  async invokeVerb(
    verb: AnalystVerb,
    args: {
      label?: string;
      by?: string;
      via?: string;
      directed?: boolean;
      writeProperty?: string;
      vectorProperty?: string;
      query?: string;
      k?: number;
      source?: string;
      target?: string;
    },
  ): Promise<QueryResult> {
    const backend = this.requireBackend();
    let buf: Buffer;
    switch (verb) {
      case "rank":
        buf = await backend.rank(
          args.label ?? "",
          args.by ?? "pagerank",
          args.via,
          args.directed,
          args.writeProperty,
        );
        break;
      case "cluster":
        buf = await backend.cluster(
          args.label ?? "",
          args.by ?? "louvain",
          args.via,
          args.directed,
          args.writeProperty,
          args.vectorProperty,
        );
        break;
      case "paths":
        buf = await backend.paths(
          args.source ?? null,
          args.target ?? null,
          args.by ?? "bfs",
          args.via,
          args.directed,
          args.k,
        );
        break;
      case "analyze":
        buf = await backend.analyze(args.label, args.by ?? "spanning_tree", args.via, args.directed);
        break;
      case "similar":
        buf = await backend.similar(
          args.label ?? "",
          args.by ?? "node_similarity",
          args.k,
          args.vectorProperty,
          args.via,
        );
        break;
      case "find":
        buf = await backend.find(args.query, args.label, args.k ?? 10);
        break;
      default:
        throw new Error(`Unknown verb: ${verb}`);
    }
    return decodeTable(buf);
  }

  /**
   * Live `by=` catalog for one verb from `algorithmDescriptorContracts()`,
   * grouped and de-duplicated by verb. Falls back to the static lists in
   * `types.ts` when the binding is missing, predates the contracts method,
   * the active runtime isn't Node (#12 — Python has no descriptor-contract
   * equivalent yet), or returns nothing for this verb — callers should show
   * `note` in the UI.
   */
  algorithmCatalog(verb: Exclude<AnalystVerb, "find">): AlgorithmCatalog {
    const fallback: AlgorithmCatalog = { items: [...FALLBACK_BY[verb]], source: "fallback" };
    if (!(this.backend instanceof NodeEngineBackend)) {
      return fallback;
    }
    const forge = this.backend.native;
    try {
      if (typeof forge.algorithmDescriptorContracts !== "function") {
        return fallback;
      }
      if (!this.algorithmContractsCache) {
        this.algorithmContractsCache = forge.algorithmDescriptorContracts();
      }
      const items = [
        ...new Set(
          this.algorithmContractsCache
            .filter((c) => c.verb === verb)
            .map((c) => c.algorithm),
        ),
      ];
      if (!items.length) {
        return { ...fallback, note: "Engine returned no contracts for this verb." };
      }
      return { items, source: "contracts" };
    } catch (err) {
      return {
        ...fallback,
        note: err instanceof Error ? err.message : String(err),
      };
    }
  }

  getBeliefPolicy(): BeliefPolicySettings {
    return { ...this.beliefPolicy };
  }

  setBeliefPolicy(policy: Partial<BeliefPolicySettings>): void {
    this.beliefPolicy = { ...this.beliefPolicy, ...policy };
  }

  async labels(): Promise<string[]> {
    try {
      return await this.requireBackend().labels();
    } catch {
      return [];
    }
  }

  async relationshipTypes(): Promise<string[]> {
    try {
      return await this.requireBackend().relationshipTypes();
    } catch {
      return [];
    }
  }

  async ontologyMode(): Promise<string> {
    if (!this.backend) {
      return "unknown";
    }
    try {
      return await this.backend.ontologyMode();
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

  async loadOntology(filePath: string): Promise<void> {
    await this.requireBackend().loadOntology(filePath);
    this._onDidChange.fire();
  }

  // ======================================================================
  // Checkpoints (#9 / ADR 0014) — Node-only
  // ======================================================================

  async createCheckpoint(name: string, description?: string): Promise<QueryResult> {
    const forge = this.requireNodeForge("checkpoint");
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
    const forge = this.requireNodeForge("listCheckpoints");
    if (typeof forge.listCheckpoints !== "function") {
      throw new UnsupportedByBindingError("listCheckpoints");
    }
    const buf = await forge.listCheckpoints({ limit, after });
    return decodeTable(buf);
  }

  /** Immutable, lease-pinned read handle over one named checkpoint. */
  openCheckpointView(name: string): CheckpointViewNative {
    const forge = this.requireNodeForge("openCheckpoint");
    if (typeof forge.openCheckpoint !== "function") {
      throw new UnsupportedByBindingError("openCheckpoint");
    }
    return forge.openCheckpoint(name);
  }

  async deleteCheckpoint(name: string): Promise<QueryResult> {
    const forge = this.requireNodeForge("deleteCheckpoint");
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
    const forge = this.requireNodeForge("diffCheckpoints");
    if (typeof forge.diffCheckpoints !== "function") {
      throw new UnsupportedByBindingError("diffCheckpoints");
    }
    const buf = await forge.diffCheckpoints({ from, to, scope, detail });
    return decodeTable(buf);
  }

  /** Restore a checkpoint as a new committed generation. Destructive — callers must hard-confirm. */
  async revertToCheckpoint(name: string, reason: string): Promise<QueryResult> {
    const forge = this.requireNodeForge("revertToCheckpoint");
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
  // Capabilities / write coordination (#11 / ADR 0015) — Node-only
  // ======================================================================

  /** Live capability manifest from the open engine (distinct from the on-disk manifest read in {@link capabilities}). */
  async liveCapabilities(): Promise<QueryResult> {
    const forge = this.requireNodeForge("projectCapabilities");
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
    const forge = this.requireNodeForge("enableCapability");
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
  // Embedding spaces (#10) — Node-only
  // ======================================================================

  embeddingSpaces(): unknown[] {
    const forge = this.requireNodeForge("embeddingSpaces");
    if (typeof forge.embeddingSpaces !== "function") {
      throw new UnsupportedByBindingError("embeddingSpaces");
    }
    return forge.embeddingSpaces();
  }

  embeddingSpace(name?: string): unknown {
    const forge = this.requireNodeForge("embeddingSpace");
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
    const forge = this.requireNodeForge("bindEmbeddingSpaceAlias");
    if (typeof forge.bindEmbeddingSpaceAlias !== "function") {
      throw new UnsupportedByBindingError("bindEmbeddingSpaceAlias");
    }
    const result = forge.bindEmbeddingSpaceAlias(name, compatibilityId, replace);
    this._onDidChange.fire();
    return result;
  }

  removeEmbeddingSpaceAlias(name: string): boolean {
    const forge = this.requireNodeForge("removeEmbeddingSpaceAlias");
    if (typeof forge.removeEmbeddingSpaceAlias !== "function") {
      throw new UnsupportedByBindingError("removeEmbeddingSpaceAlias");
    }
    const removed = forge.removeEmbeddingSpaceAlias(name);
    this._onDidChange.fire();
    return removed;
  }

  setDefaultEmbeddingSpace(name?: string): unknown {
    const forge = this.requireNodeForge("setDefaultEmbeddingSpace");
    if (typeof forge.setDefaultEmbeddingSpace !== "function") {
      throw new UnsupportedByBindingError("setDefaultEmbeddingSpace");
    }
    const result = forge.setDefaultEmbeddingSpace(name ?? null);
    this._onDidChange.fire();
    return result;
  }

  deleteEmbeddingSpace(name?: string): boolean {
    const forge = this.requireNodeForge("deleteEmbeddingSpace");
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
    const forge = this.requireNodeForge("publishCallerEmbeddings");
    if (typeof forge.publishCallerEmbeddings !== "function") {
      throw new UnsupportedByBindingError("publishCallerEmbeddings");
    }
    const id = forge.publishCallerEmbeddings(name, input);
    this._onDidChange.fire();
    return id;
  }

  inspectEmbeddingSpaceFreshness(name?: string, forceStale?: boolean): unknown {
    const forge = this.requireNodeForge("inspectEmbeddingSpaceFreshness");
    if (typeof forge.inspectEmbeddingSpaceFreshness !== "function") {
      throw new UnsupportedByBindingError("inspectEmbeddingSpaceFreshness");
    }
    return forge.inspectEmbeddingSpaceFreshness(name ?? null, forceStale);
  }

  // ======================================================================
  // Find + index management (#8) — Node-only
  // ======================================================================

  buildTextIndex(label: string, properties?: string[], rebuild?: boolean): unknown {
    const forge = this.requireNodeForge("index");
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
    const forge = this.requireNodeForge("index");
    if (typeof forge.index !== "function") {
      throw new UnsupportedByBindingError("index");
    }
    const result = forge.index(label, { node, vector, space });
    this._onDidChange.fire();
    return result;
  }

  inspectTextIndex(label: string, properties?: string[]): unknown {
    const forge = this.requireNodeForge("inspectTextIndex");
    if (typeof forge.inspectTextIndex !== "function") {
      throw new UnsupportedByBindingError("inspectTextIndex");
    }
    return forge.inspectTextIndex(label, properties?.length ? properties : null);
  }

  buildAdjacencyIndex(): unknown {
    const forge = this.requireNodeForge("indexAdjacency");
    if (typeof forge.indexAdjacency !== "function") {
      throw new UnsupportedByBindingError("indexAdjacency");
    }
    const result = forge.indexAdjacency();
    this._onDidChange.fire();
    return result;
  }

  inspectAdjacencyIndex(): unknown {
    const forge = this.requireNodeForge("inspectAdjacency");
    if (typeof forge.inspectAdjacency !== "function") {
      throw new UnsupportedByBindingError("inspectAdjacency");
    }
    return forge.inspectAdjacency();
  }

  rebuildAdjacencyIndex(): unknown {
    const forge = this.requireNodeForge("rebuildAdjacency");
    if (typeof forge.rebuildAdjacency !== "function") {
      throw new UnsupportedByBindingError("rebuildAdjacency");
    }
    const result = forge.rebuildAdjacency();
    this._onDidChange.fire();
    return result;
  }

  // ======================================================================
  // Invocation descriptors / algorithm runs (#11) — Node-only
  // ======================================================================

  algorithmDescriptorContracts(): AlgorithmDescriptorContractNative[] {
    const forge = this.requireNodeForge("algorithmDescriptorContracts");
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
    const forge = this.requireNodeForge("prepareInvocation");
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
    const forge = this.requireNodeForge("invokeDescriptor");
    if (typeof forge.invokeDescriptor !== "function") {
      throw new UnsupportedByBindingError("invokeDescriptor");
    }
    const buf = forge.invokeDescriptor(descriptor);
    return decodeTable(buf);
  }

  async listAlgorithmRuns(algorithm?: string, limit?: number): Promise<QueryResult> {
    const forge = this.requireNodeForge("listAlgorithmRuns");
    if (typeof forge.listAlgorithmRuns !== "function") {
      throw new UnsupportedByBindingError("listAlgorithmRuns");
    }
    const buf = await forge.listAlgorithmRuns({ algorithm, limit });
    return decodeTable(buf);
  }

  async algorithmRun(runUuid: string): Promise<QueryResult> {
    const forge = this.requireNodeForge("algorithmRun");
    if (typeof forge.algorithmRun !== "function") {
      throw new UnsupportedByBindingError("algorithmRun");
    }
    const buf = await forge.algorithmRun(runUuid);
    return decodeTable(buf);
  }

  // ======================================================================
  // Composite transactions (#11, expert/Advanced-only) — Node-only
  // ======================================================================

  publishCompositeTransaction(request: unknown): QueryResult {
    const forge = this.requireNodeForge("publishCompositeTransaction");
    if (typeof forge.publishCompositeTransaction !== "function") {
      throw new UnsupportedByBindingError("publishCompositeTransaction");
    }
    const buf = forge.publishCompositeTransaction(request);
    const result = decodeTable(buf);
    this._onDidChange.fire();
    return result;
  }

  /**
   * True once the active backend exposes the knowledge (assertions) surface
   * at all. `listAssertions` is part of the runtime-agnostic
   * {@link EngineBackend} facade (#12), so this works for either runtime —
   * the Node adapter forwards to the native binding's `listAssertions`, and
   * the Python bridge exposes its own.
   */
  knowledgeCapabilityAvailable(): boolean {
    return typeof this.backend?.listAssertions === "function";
  }

  async knowledgeSummary(): Promise<KnowledgeSummary> {
    if (!this.backend) {
      return {
        capabilityAvailable: false,
        assertionCount: 0,
        statusCounts: {},
        statusAvailable: false,
        assertions: [],
        note: "No GraphForge session open.",
      };
    }
    if (!this.knowledgeCapabilityAvailable()) {
      return {
        capabilityAvailable: false,
        assertionCount: 0,
        statusCounts: {},
        statusAvailable: false,
        assertions: [],
        note:
          this.backend.runtime === "node"
            ? (this.bindingAvailable
                ? "This @curatelabs/graphforge binding does not expose listAssertions() yet."
                : this.bindingError)
            : "Knowledge ledger APIs not yet wired for the Python runtime.",
      };
    }
    try {
      const result = await this.listAssertions({ limit: 50 });
      const assertions = rowsToAssertions(result);
      const resolution = await this.resolveAssertionStatuses(
        assertions.map((a) => a.assertionUuid),
      );
      if (resolution.available) {
        for (const assertion of assertions) {
          const status = resolution.statuses.get(assertion.assertionUuid);
          if (status) {
            assertion.status = status;
          }
        }
      }
      return {
        capabilityAvailable: true,
        assertionCount: result.rowCount,
        statusCounts: aggregateStatusCounts(assertions.map((a) => a.status)),
        statusAvailable: resolution.available,
        statusNote: resolution.note,
        assertions,
      };
    } catch (err) {
      return {
        capabilityAvailable: true,
        assertionCount: 0,
        statusCounts: {},
        statusAvailable: false,
        assertions: [],
        note: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Best-effort current-status lookup for a page of assertion UUIDs, for the
   * Knowledge view (#35). Mirrors {@link resolveEpistemicStatuses}'
   * fallbacks: Node-only, requires the binding's `assertionStatus()`, an
   * empty status table is a legitimate "statusless", per-item failures are
   * swallowed, and total unavailability degrades to `{ available: false }`
   * with an honest note — never a thrown error, never an invented status.
   */
  private async resolveAssertionStatuses(
    assertionUuids: string[],
  ): Promise<{ available: boolean; statuses: Map<string, EpistemicStatus>; note?: string }> {
    const empty = new Map<string, EpistemicStatus>();
    if (assertionUuids.length === 0) {
      return { available: true, statuses: empty };
    }
    if (!(this.backend instanceof NodeEngineBackend)) {
      return {
        available: false,
        statuses: empty,
        note: "Assertion status lookup requires the Node runtime — status unavailable.",
      };
    }
    const assertionStatus = this.backend.native.assertionStatus;
    if (typeof assertionStatus !== "function") {
      return {
        available: false,
        statuses: empty,
        note: "This @curatelabs/graphforge binding does not expose assertionStatus() — status unavailable.",
      };
    }

    const statuses = new Map<string, EpistemicStatus>();
    let failures = 0;
    const resolveOne = async (uuid: string): Promise<void> => {
      try {
        const table = decodeTable(await resolveIpcBuffer(assertionStatus(uuid)));
        const raw = table.rowCount > 0 ? stringField(table.rows[0], "status") : undefined;
        statuses.set(uuid, isEpistemicStatus(raw) ? raw : "statusless");
      } catch {
        failures += 1;
      }
    };

    const concurrency = 6;
    for (let i = 0; i < assertionUuids.length; i += concurrency) {
      await Promise.all(assertionUuids.slice(i, i + concurrency).map(resolveOne));
    }

    if (statuses.size === 0 && failures > 0) {
      return {
        available: false,
        statuses: empty,
        note: "Status lookup failed for every assertion — status unavailable.",
      };
    }
    return {
      available: true,
      statuses,
      note:
        failures > 0
          ? `${failures} assertion(s) failed status lookup (shown without status).`
          : undefined,
    };
  }

  /** List a page of immutable assertions (`listAssertions`); works on either runtime via {@link EngineBackend}. */
  async listAssertions(request?: ListAssertionsInput): Promise<QueryResult> {
    const backend = this.requireBackend();
    if (!backend.listAssertions) {
      throw new UnsupportedByBindingError("listAssertions");
    }
    const buf = await backend.listAssertions({
      graphUuid: request?.graphUuid,
      limit: request?.limit,
      after: request?.after,
    });
    return decodeTable(buf);
  }

  /**
   * Fetch one assertion by UUID; falls back to a filtered list page if
   * `assertion()` is absent. Node-only: the Python bridge does not expose
   * per-assertion lookup yet (#12), but the list-page fallback keeps this
   * usable there too as long as `listAssertions` works.
   */
  async getAssertion(assertionUuid: string): Promise<AssertionRow | undefined> {
    let row: AssertionRow | undefined;
    if (this.backend instanceof NodeEngineBackend) {
      const forge = this.backend.native;
      if (typeof forge.assertion === "function") {
        const buf = await resolveIpcBuffer(forge.assertion(assertionUuid));
        const result = decodeTable(buf);
        row = rowsToAssertions(result)[0];
      }
    }
    if (!row) {
      const result = await this.listAssertions({ limit: 200 });
      row = rowsToAssertions(result).find(
        (a) => a.assertionUuid === assertionUuid,
      );
    }
    if (!row) {
      return undefined;
    }
    // Detail JSON names the current explicit status (#35) — or says honestly
    // why it can't, instead of omitting the field silently.
    const resolution = await this.resolveAssertionStatuses([assertionUuid]);
    if (resolution.available) {
      row.status = resolution.statuses.get(assertionUuid) ?? "statusless";
    } else {
      row.statusNote = resolution.note;
    }
    return row;
  }

  /** Graph node/edge references for one assertion (subject/object/context), for "show on graph". Node-only. */
  async assertionGraphRefs(assertionUuid: string): Promise<TableRow[]> {
    const forge = this.requireNodeForge("assertionGraphRefs");
    if (typeof forge.assertionGraphRefs !== "function") {
      throw new UnsupportedByBindingError("assertionGraphRefs");
    }
    const buf = await resolveIpcBuffer(forge.assertionGraphRefs(assertionUuid));
    return decodeTable(buf).rows;
  }

  /**
   * Create one immutable assertion with minimal required fields (claim + at
   * least one graph reference). Identity UUIDs are minted here (UUIDv7) so the
   * analyst never has to paste one in for the primary Create Assertion path.
   * Node-only (#12) — knowledge-ledger writes are not yet wired for Python.
   */
  async createAssertion(input: {
    claim: string;
    graphRefs: CreateAssertionInput["graphRefs"];
    actorUuid?: string;
  }): Promise<{ assertionUuid: string; result: QueryResult }> {
    const forge = this.requireNodeForge("createAssertion");
    if (typeof forge.createAssertion !== "function") {
      throw new UnsupportedByBindingError("createAssertion");
    }
    if (!input.graphRefs.length) {
      throw new Error("Create Assertion requires at least one graph reference.");
    }
    const assertionUuid = uuidv7();
    const buf = await resolveIpcBuffer(
      forge.createAssertion({
        operationUuid: randomOperationId(),
        assertionUuid,
        claim: input.claim,
        graphRefs: input.graphRefs,
        actorUuid: input.actorUuid,
      }),
    );
    const result = decodeTable(buf);
    this._onDidChange.fire();
    return { assertionUuid, result };
  }

  /** Advanced: attach one immutable evidence link to an existing assertion. Node-only. */
  async attachEvidence(
    input: Omit<AttachEvidenceInput, "operationUuid" | "evidenceUuid">,
  ): Promise<QueryResult> {
    const forge = this.requireNodeForge("attachEvidence");
    if (typeof forge.attachEvidence !== "function") {
      throw new UnsupportedByBindingError("attachEvidence");
    }
    const buf = await resolveIpcBuffer(
      forge.attachEvidence({
        operationUuid: randomOperationId(),
        evidenceUuid: uuidv7(),
        ...input,
      }),
    );
    const result = decodeTable(buf);
    this._onDidChange.fire();
    return result;
  }

  /** Advanced: record one immutable confidence assessment for an assertion. Node-only. */
  async assessConfidence(
    input: Omit<AssessConfidenceInput, "operationUuid" | "confidenceUuid">,
  ): Promise<QueryResult> {
    const forge = this.requireNodeForge("assessConfidence");
    if (typeof forge.assessConfidence !== "function") {
      throw new UnsupportedByBindingError("assessConfidence");
    }
    const buf = await resolveIpcBuffer(
      forge.assessConfidence({
        operationUuid: randomOperationId(),
        confidenceUuid: uuidv7(),
        ...input,
      }),
    );
    const result = decodeTable(buf);
    this._onDidChange.fire();
    return result;
  }

  /** Advanced: record one explicit assertion-status event (requires an existing provenance UUID). Node-only. */
  async recordAssertionStatus(
    input: Omit<RecordAssertionStatusInput, "operationUuid" | "statusEventUuid">,
  ): Promise<QueryResult> {
    const forge = this.requireNodeForge("recordAssertionStatus");
    if (typeof forge.recordAssertionStatus !== "function") {
      throw new UnsupportedByBindingError("recordAssertionStatus");
    }
    const buf = await resolveIpcBuffer(
      forge.recordAssertionStatus({
        operationUuid: randomOperationId(),
        statusEventUuid: uuidv7(),
        ...input,
      }),
    );
    const result = decodeTable(buf);
    this._onDidChange.fire();
    return result;
  }

  /** Status event history, optionally filtered to one assertion. Node-only. */
  async listAssertionStatus(request?: ListAssertionStatusInput): Promise<QueryResult> {
    const forge = this.requireNodeForge("listAssertionStatus");
    if (typeof forge.listAssertionStatus !== "function") {
      throw new UnsupportedByBindingError("listAssertionStatus");
    }
    const buf = await resolveIpcBuffer(
      forge.listAssertionStatus({
        assertionUuid: request?.assertionUuid,
        limit: request?.limit,
        after: request?.after,
      }),
    );
    return decodeTable(buf);
  }

  /**
   * Build a graph payload from tabular results, then (when the project has
   * the `knowledge` + `epistemic` capabilities, the active backend is Node,
   * and the binding exposes the status APIs) resolve real ledger status for
   * each node UUID. Remembers the raw result so `GraphForge: Show Result
   * Graph` can refresh/re-resolve without re-running the query or verb.
   */
  async toGraphPayload(result: QueryResult, title?: string): Promise<GraphPayload> {
    this.lastResult = result;
    this.lastResultTitle = title;

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
          });
        }
        if (!nodes.has(target)) {
          nodes.set(target, {
            id: target,
            labels: ["Node"],
            properties: {},
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

    const resolution = await this.resolveEpistemicStatuses([...nodes.keys()]);
    let styleMode: GraphStyleMode = "class-only";
    if (resolution.active) {
      styleMode = "epistemic";
      for (const [id, status] of resolution.statuses) {
        const node = nodes.get(id);
        if (node) {
          node.epistemicStatus = status;
        }
      }
    } else {
      // No fake statuses when the knowledge capability (or binding support)
      // is absent — strip any speculative per-row hints and style by class.
      for (const node of nodes.values()) {
        delete node.epistemicStatus;
      }
      for (const edge of edges) {
        delete edge.epistemicStatus;
      }
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
        statuses: ALL_EPISTEMIC_STATUSES,
        types,
      },
      title,
      styleMode,
      banner: resolution.note,
    };
  }

  /** Rebuild the last query/verb result's graph payload (palette refresh). */
  async lastGraphPayload(): Promise<GraphPayload> {
    if (this.lastResult) {
      return this.toGraphPayload(this.lastResult, this.lastResultTitle);
    }
    return this.toGraphPayload({ columns: [], rows: [], rowCount: 0 }, "Demo graph");
  }

  get hasLastResult(): boolean {
    return this.lastResult !== undefined;
  }

  /**
   * Best-effort ledger status resolution for a bounded set of node UUIDs:
   * `listAssertions({ graphUuid })` to find an assertion about the node, then
   * `assertionStatus(assertionUuid)` for its current explicit status (empty
   * table = legitimately statusless). Node-only — falls back to `{ active:
   * false }` (class-only styling) on the Python runtime rather than
   * inventing a status. Defensive throughout otherwise: the engine API may
   * still be moving; any missing method, missing capability, or thrown error
   * also falls back to `{ active: false }`.
   */
  private async resolveEpistemicStatuses(
    nodeIds: string[],
  ): Promise<{ active: boolean; statuses: Map<string, EpistemicStatus>; note?: string }> {
    const empty = new Map<string, EpistemicStatus>();
    if (!this.backend || nodeIds.length === 0) {
      return { active: false, statuses: empty };
    }
    if (!(this.backend instanceof NodeEngineBackend)) {
      return {
        active: false,
        statuses: empty,
        note: "Epistemic status resolution requires the Node runtime — class-only styling.",
      };
    }
    if (!this.beliefPolicy.enabled) {
      return {
        active: false,
        statuses: empty,
        note: "Epistemic resolution disabled (GraphForge: Result Graph (Advanced)…) — class-only styling.",
      };
    }
    const caps = this.capabilities().capabilities;
    if (!caps.includes("knowledge") || !caps.includes("epistemic")) {
      return {
        active: false,
        statuses: empty,
        note: "Knowledge capability not enabled for this project — class-only styling.",
      };
    }
    const forge = this.backend.native;
    const listAssertions = forge.listAssertions;
    const assertionStatus = forge.assertionStatus;
    if (typeof listAssertions !== "function" || typeof assertionStatus !== "function") {
      return {
        active: false,
        statuses: empty,
        note: "GraphForge binding does not expose belief/status APIs yet — class-only styling.",
      };
    }

    const cap = Math.max(1, this.beliefPolicy.maxNodes);
    const truncated = nodeIds.length > cap;
    const ids = nodeIds.slice(0, cap);
    const statuses = new Map<string, EpistemicStatus>();
    let failures = 0;

    const resolveOne = async (uuid: string): Promise<void> => {
      try {
        const assertions = decodeTable(await listAssertions({ graphUuid: uuid, limit: 1 }));
        const assertionUuid =
          assertions.rowCount > 0 ? stringField(assertions.rows[0], "assertion_uuid") : undefined;
        if (!assertionUuid) {
          statuses.set(uuid, "statusless");
          return;
        }
        const statusTable = decodeTable(await assertionStatus(assertionUuid));
        const raw = statusTable.rowCount > 0 ? stringField(statusTable.rows[0], "status") : undefined;
        statuses.set(uuid, isEpistemicStatus(raw) ? raw : "statusless");
      } catch {
        failures += 1;
      }
    };

    const concurrency = 6;
    for (let i = 0; i < ids.length; i += concurrency) {
      await Promise.all(ids.slice(i, i + concurrency).map(resolveOne));
    }

    if (statuses.size === 0 && failures > 0) {
      return {
        active: false,
        statuses: empty,
        note: "Belief status lookup failed for every resolved node — class-only styling.",
      };
    }

    const notes: string[] = [];
    if (truncated) {
      notes.push(`Resolved epistemic status for first ${cap} of ${nodeIds.length} nodes.`);
    }
    if (failures > 0) {
      notes.push(`${failures} node(s) failed status lookup (left class-only).`);
    }
    return { active: true, statuses, note: notes.length ? notes.join(" ") : undefined };
  }

  notifyChanged(): void {
    this._onDidChange.fire();
    this.refreshStatus();
  }

  private refreshStatus(): void {
    void this.refreshStatusAsync();
  }

  private async refreshStatusAsync(): Promise<void> {
    if (this.activeProject && this.backend) {
      const mode = await this.ontologyMode();
      const runtimeLabel = this.backend.runtime === "python" ? "Python" : "Node";
      this.statusBar.text = `$(database) GraphForge: ${this.activeProject.name} (${mode}) · ${runtimeLabel}`;
      this.statusBar.tooltip = `${this.activeProject.rootPath}\nRuntime: ${runtimeLabel}`;
      return;
    }

    const snapshot = await this.environmentSnapshot();
    const usable =
      chooseRuntime(snapshot.preference, snapshot.node, snapshot.python, snapshot.projectKind) !== undefined;
    if (!usable) {
      this.statusBar.text = "$(warning) GraphForge: no runtime";
      this.statusBar.tooltip = describeRuntimeUnavailable(
        snapshot.preference,
        snapshot.node,
        snapshot.python,
      );
      return;
    }
    this.statusBar.text = "$(database) GraphForge";
    this.statusBar.tooltip = "No project open";
  }
}

function rowsToAssertions(result: QueryResult): AssertionRow[] {
  return result.rows.map((row) => ({
    assertionUuid:
      stringField(row, "assertion_uuid") ?? stringField(row, "uuid") ?? "",
    claim: stringField(row, "claim") ?? "",
    ...row,
  }));
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

/**
 * Optional per-row status hint from the query/verb result itself (e.g. a
 * Cypher query that projects `n.epistemic_status`). Returns `undefined` —
 * never a default "statusless" — so `toGraphPayload` can tell a real hint
 * apart from "no data": defaulting here would fabricate a status when the
 * knowledge capability is absent.
 */
function statusFromRow(row: TableRow): EpistemicStatus | undefined {
  const raw = stringField(row, "epistemic_status") ?? stringField(row, "status");
  return isEpistemicStatus(raw) ? raw : undefined;
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
      statuses: ALL_EPISTEMIC_STATUSES,
      types: ["Person", "Org"],
    },
    title,
    styleMode: "demo",
    banner: "Demo graph — no graph-shaped rows in the last result.",
  };
}
