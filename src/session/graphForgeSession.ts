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
  AnalystVerb,
  DetectedProject,
  EpistemicStatus,
  GraphEdge,
  GraphForgeNative,
  GraphNode,
  GraphPayload,
  KnowledgeSummary,
  OntologyDoc,
  ProjectCapabilities,
  QueryResult,
  TableRow,
} from "./types";

export class GraphForgeSession implements vscode.Disposable {
  private forge: GraphForgeNative | undefined;
  private activeProject: DetectedProject | undefined;
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
        buf = forge.find(args.query, args.label, args.k ?? 10);
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
