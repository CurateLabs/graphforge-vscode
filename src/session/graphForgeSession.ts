import { tableFromIPC, type Table } from "apache-arrow";
import * as vscode from "vscode";
import { getNativeLoadError, loadGraphForgeModule } from "./nativeLoader";
import {
  discoverProjects,
  isGraphForgeProject,
  readManifestCapabilities,
  readWorkspaceOntology,
} from "./projectDetector";
import {
  AlgorithmDescriptorContract,
  AnalystVerb,
  BeliefPolicySettings,
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
  OntologyDoc,
  ProjectCapabilities,
  QueryResult,
  TableRow,
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

export class GraphForgeSession implements vscode.Disposable {
  private forge: GraphForgeNative | undefined;
  private activeProject: DetectedProject | undefined;
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
    // `listAssertions`/`assertionStatus` are async (napi AsyncTask); a
    // synchronous ledger summary needs a paged/aggregating call this
    // scaffold doesn't have yet. Per-node epistemic status is wired for the
    // Result Graph (see `resolveEpistemicStatuses`); full ledger browsing is
    // Knowledge view scope (#6).
    return {
      assertionCount: 0,
      statusCounts: {},
      note: "Knowledge ledger summary pending (#6). Result Graph resolves per-node status live.",
    };
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
