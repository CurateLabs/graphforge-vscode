import * as vscode from "vscode";
import { decodeTable, stringField } from "./arrowCodec";
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
import {
  AnalystVerb,
  DetectedProject,
  EngineBackend,
  EpistemicStatus,
  GraphEdge,
  GraphNode,
  GraphPayload,
  KnowledgeSummary,
  OntologyDoc,
  ProjectCapabilities,
  PythonRuntimeStatus,
  QueryResult,
  RuntimeKind,
  RuntimePreference,
  TableRow,
} from "./types";

export interface RuntimeEnvironmentSnapshot {
  preference: RuntimePreference;
  node: NodeBindingStatus;
  python: PythonRuntimeStatus;
  /** What kind of workspace this looks like (Python-first, Node-ish, or ambiguous); see `projectKind.ts`. */
  projectKind: ProjectKind;
  /** Runtime actually backing the open session, if any. */
  active: RuntimeKind | undefined;
}

export class GraphForgeSession implements vscode.Disposable {
  private backend: EngineBackend | undefined;
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
    void this.backend?.dispose();
    this.backend = undefined;
  }

  get project(): DetectedProject | undefined {
    return this.activeProject;
  }

  /** Runtime actually backing the open session (undefined until a project is open). */
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

  private async attachBackend(rootPath: string): Promise<void> {
    let backend: EngineBackend;
    try {
      backend = await openEngineBackend(rootPath);
    } catch (err) {
      this.refreshStatus();
      throw err instanceof Error ? err : new Error(String(err));
    }

    const previous = this.backend;
    this.backend = backend;
    if (previous) {
      void previous.dispose();
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
        );
        break;
      case "cluster":
        buf = await backend.cluster(
          args.label ?? "",
          args.by ?? "louvain",
          args.via,
          args.directed,
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
        buf = await backend.similar(args.label ?? "", args.by ?? "node_similarity", args.k);
        break;
      case "find":
        buf = await backend.find(args.query, args.label, args.k ?? 10);
        break;
      default:
        throw new Error(`Unknown verb: ${verb}`);
    }
    return decodeTable(buf);
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

  async knowledgeSummary(): Promise<KnowledgeSummary> {
    if (!this.backend) {
      return {
        assertionCount: 0,
        statusCounts: {},
        note: "No GraphForge session open.",
      };
    }
    if (!this.backend.listAssertions) {
      return {
        assertionCount: 0,
        statusCounts: {},
        note: "Knowledge ledger APIs not yet wired for this runtime.",
      };
    }
    try {
      const buf = await this.backend.listAssertions();
      const result = decodeTable(buf);
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
