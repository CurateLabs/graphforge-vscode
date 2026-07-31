import * as vscode from "vscode";
import { decodeTable, resolveIpcBuffer, stringField } from "./arrowCodec";
import { getNativeLoadError, loadGraphForgeModule } from "./nativeLoader";
import {
  discoverProjects,
  isGraphForgeProject,
  readManifestCapabilities,
  readWorkspaceOntology,
} from "./projectDetector";
import { randomOperationId, uuidv7 } from "./uuid";
import {
  AlgorithmDescriptorContract,
  AnalystVerb,
  AssertionRow,
  AssessConfidenceInput,
  AttachEvidenceInput,
  BeliefPolicySettings,
  CreateAssertionInput,
  DEFAULT_BELIEF_POLICY,
  DetectedProject,
  EpistemicStatus,
  FALLBACK_BY,
  GraphEdge,
  GraphForgeNative,
  GraphNode,
  GraphPayload,
  GraphStyleMode,
  KnowledgeSummary,
  ListAssertionsInput,
  ListAssertionStatusInput,
  OntologyDoc,
  ProjectCapabilities,
  QueryResult,
  RecordAssertionStatusInput,
  TableRow,
  WriteMode,
} from "./types";

/** Live catalog for one verb, or the static fallback with a UI-visible reason. */
export interface AlgorithmCatalog {
  items: string[];
  source: "contracts" | "fallback";
  note?: string;
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

  get writeMode(): WriteMode {
    return this.activeWriteMode;
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

  private async attachForge(rootPath: string): Promise<void> {
    const mod = loadGraphForgeModule();
    if (!mod) {
      this.refreshStatus();
      throw new Error(getNativeLoadError() ?? "Native binding unavailable");
    }

    try {
      this.forge = new mod.GraphForge(rootPath, { writeMode: "single_writer" });
    } catch (err) {
      // In-memory fallback attempt is not appropriate for project open; surface error.
      this.forge = undefined;
      throw err instanceof Error ? err : new Error(String(err));
    }
    this.algorithmContractsCache = undefined;
    this.lastResult = undefined;
    this.lastResultTitle = undefined;

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
      writeProperty?: string;
      vectorProperty?: string;
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
          args.writeProperty,
        );
        break;
      case "cluster":
        buf = forge.cluster(
          args.label ?? "",
          args.by ?? "louvain",
          args.via,
          args.directed,
          args.writeProperty,
          args.vectorProperty,
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
        buf = forge.similar(
          args.label ?? "",
          args.by ?? "node_similarity",
          args.k,
          args.vectorProperty,
          args.via,
        );
        break;
      case "find":
        buf = forge.find(args.query, args.label, args.k ?? 10);
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
   * or returns nothing for this verb — callers should show `note` in the UI.
   */
  algorithmCatalog(verb: Exclude<AnalystVerb, "find">): AlgorithmCatalog {
    const fallback: AlgorithmCatalog = { items: [...FALLBACK_BY[verb]], source: "fallback" };
    if (!this.forge) {
      return fallback;
    }
    try {
      if (typeof this.forge.algorithmDescriptorContracts !== "function") {
        return fallback;
      }
      if (!this.algorithmContractsCache) {
        this.algorithmContractsCache = this.forge.algorithmDescriptorContracts();
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

  /** True once the current binding exposes the knowledge (assertions) surface at all. */
  knowledgeCapabilityAvailable(): boolean {
    return typeof this.forge?.listAssertions === "function";
  }

  async knowledgeSummary(): Promise<KnowledgeSummary> {
    if (!this.knowledgeCapabilityAvailable()) {
      return {
        capabilityAvailable: false,
        assertionCount: 0,
        statusCounts: {},
        assertions: [],
        note: this.bindingAvailable
          ? "This @graphforge/node binding does not expose listAssertions() yet."
          : getNativeLoadError(),
      };
    }
    try {
      const result = await this.listAssertions({ limit: 50 });
      return {
        capabilityAvailable: true,
        assertionCount: result.rowCount,
        statusCounts: {},
        assertions: rowsToAssertions(result),
        note:
          result.rowCount === 0
            ? undefined
            : "Status breakdown pending per-assertion status lookup; see assertion detail.",
      };
    } catch (err) {
      return {
        capabilityAvailable: true,
        assertionCount: 0,
        statusCounts: {},
        assertions: [],
        note: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** List a page of immutable assertions (`listAssertions`), defensively. */
  async listAssertions(request?: ListAssertionsInput): Promise<QueryResult> {
    const forge = this.requireForge();
    if (typeof forge.listAssertions !== "function") {
      throw new UnsupportedByBindingError("listAssertions");
    }
    const buf = await resolveIpcBuffer(
      forge.listAssertions({
        graphUuid: request?.graphUuid,
        limit: request?.limit,
        after: request?.after,
      }),
    );
    return decodeTable(buf);
  }

  /** Fetch one assertion by UUID; falls back to a filtered list page if `assertion()` is absent. */
  async getAssertion(assertionUuid: string): Promise<AssertionRow | undefined> {
    const forge = this.requireForge();
    if (typeof forge.assertion === "function") {
      const buf = await resolveIpcBuffer(forge.assertion(assertionUuid));
      const result = decodeTable(buf);
      return rowsToAssertions(result)[0];
    }
    const result = await this.listAssertions({ limit: 200 });
    return rowsToAssertions(result).find(
      (a) => a.assertionUuid === assertionUuid,
    );
  }

  /** Graph node/edge references for one assertion (subject/object/context), for "show on graph". */
  async assertionGraphRefs(assertionUuid: string): Promise<TableRow[]> {
    const forge = this.requireForge();
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
   */
  async createAssertion(input: {
    claim: string;
    graphRefs: CreateAssertionInput["graphRefs"];
    actorUuid?: string;
  }): Promise<{ assertionUuid: string; result: QueryResult }> {
    const forge = this.requireForge();
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

  /** Advanced: attach one immutable evidence link to an existing assertion. */
  async attachEvidence(
    input: Omit<AttachEvidenceInput, "operationUuid" | "evidenceUuid">,
  ): Promise<QueryResult> {
    const forge = this.requireForge();
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

  /** Advanced: record one immutable confidence assessment for an assertion. */
  async assessConfidence(
    input: Omit<AssessConfidenceInput, "operationUuid" | "confidenceUuid">,
  ): Promise<QueryResult> {
    const forge = this.requireForge();
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

  /** Advanced: record one explicit assertion-status event (requires an existing provenance UUID). */
  async recordAssertionStatus(
    input: Omit<RecordAssertionStatusInput, "operationUuid" | "statusEventUuid">,
  ): Promise<QueryResult> {
    const forge = this.requireForge();
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

  /** Status event history, optionally filtered to one assertion. */
  async listAssertionStatus(request?: ListAssertionStatusInput): Promise<QueryResult> {
    const forge = this.requireForge();
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
   * the `knowledge` + `epistemic` capabilities and the binding exposes the
   * status APIs) resolve real ledger status for each node UUID. Remembers
   * the raw result so `GraphForge: Show Result Graph` can refresh/re-resolve
   * without re-running the query or verb.
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
   * table = legitimately statusless). Defensive throughout — the engine API
   * may still be moving; any missing method, missing capability, or thrown
   * error falls back to `{ active: false }` (class-only styling) rather than
   * inventing a status.
   */
  private async resolveEpistemicStatuses(
    nodeIds: string[],
  ): Promise<{ active: boolean; statuses: Map<string, EpistemicStatus>; note?: string }> {
    const empty = new Map<string, EpistemicStatus>();
    if (!this.forge || nodeIds.length === 0) {
      return { active: false, statuses: empty };
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
    const forge = this.forge;
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
