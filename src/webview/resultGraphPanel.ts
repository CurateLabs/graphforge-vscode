import * as crypto from "node:crypto";
import * as vscode from "vscode";
import type { GraphPayload, QueryResult } from "../session/types";
import { replaceProjectVisualization } from "../session/projectArtifacts";
import type { ResultGraphVisualizationSpecV2 } from "../session/visualizationRegistry";
import { VisualizationDocumentState } from "../session/visualizationDocumentState";
import type { HostToWebview, WebviewToHost } from "./protocol";
import { EntityInspectPanel } from "./entityInspectPanel";
import {
  graphForgeVizShowOptions,
  revealVizPanel,
  trackVizPanel,
} from "./panelColumn";
import {
  normalizeResultGraphRenderer,
  resolveGraphSelection,
  type GraphSelection,
  type ResultGraphViewOptions,
} from "./resultGraphModel";
import {
  resolveResultGraphHighlight,
  type GraphElementHighlight,
} from "./resultTableModel";
import {
  visualizationInstanceId,
  visualizationInstances,
  VisualizationInstanceLifecycle,
  type VisualizationController,
} from "./visualizationInstanceRegistry";

export interface ResultGraphInstanceOptions {
  instanceId?: string;
  coordinationGroup?: string;
}

export type ResultGraphLifecycleMessage = Extract<
  WebviewToHost,
  {
    type:
      | "graphforge/renderStarted"
      | "graphforge/layoutStarted"
      | "graphforge/layoutReady"
      | "graphforge/renderReady"
      | "graphforge/renderFailed";
  }
>;

export class ResultGraphPanel implements VisualizationController {
  public readonly kind = "graph" as const;
  private readonly lifecycle: VisualizationInstanceLifecycle;
  public get renderGeneration(): number { return this.lifecycle.renderGeneration; }
  private static readonly selectionEmitter =
    new vscode.EventEmitter<GraphSelection>();
  public static readonly onDidSelect = ResultGraphPanel.selectionEmitter.event;
  private static readonly timebarEmitter =
    new vscode.EventEmitter<{ values: [number, number] }>();
  public static readonly onDidChangeTimebar =
    ResultGraphPanel.timebarEmitter.event;
  private static readonly lifecycleEmitter =
    new vscode.EventEmitter<ResultGraphLifecycleMessage>();
  public static readonly onDidLifecycle = ResultGraphPanel.lifecycleEmitter.event;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private webviewReady = false;
  private payload: GraphPayload | undefined;
  private viewOptions: ResultGraphViewOptions = {};
  private artifact:
    | {
        projectRoot: string;
        path: string;
        state: VisualizationDocumentState<ResultGraphVisualizationSpecV2>;
        committedValues?: [number, number];
        onSaved?: () => void;
      }
    | undefined;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    public readonly instanceId: string,
    public readonly coordinationGroup?: string,
  ) {
    this.lifecycle = new VisualizationInstanceLifecycle(instanceId);
    this.panel = panel;
    trackVizPanel(panel);
    this.panel.onDidDispose(() => {
      visualizationInstances.remove(this.instanceId);
      this.lifecycle.dispose();
      for (const disposable of this.disposables.splice(0)) {
        disposable.dispose();
      }
    });
    this.panel.webview.onDidReceiveMessage((msg: WebviewToHost) => {
      if (msg.type === "graphforge/ready") {
        this.webviewReady = true;
        this.postContext();
        this.postRenderer(false);
        this.postOptions(false);
        if (this.payload) {
          this.postGraph(this.payload);
        }
        this.postArtifactState();
        return;
      }
      if (!this.lifecycle.accepts(msg)) {
        return;
      }
      if (msg.type === "graphforge/renderFailed") {
        ResultGraphPanel.lifecycleEmitter.fire(msg);
        console.error(
          `[GraphForge] Result Graph ${msg.renderer}/${msg.phase} failed (${msg.code}): ${msg.message}`,
        );
        return;
      }
      if (msg.type === "graphforge/renderStarted") {
        ResultGraphPanel.lifecycleEmitter.fire(msg);
        console.info(
          `[GraphForge] Result Graph ${msg.renderer}/${msg.backend ?? "default"} render started (${msg.nodeCount} nodes, ${msg.edgeCount} edges).`,
        );
        return;
      }
      if (msg.type === "graphforge/layoutStarted") {
        ResultGraphPanel.lifecycleEmitter.fire(msg);
        console.info(
          `[GraphForge] Result Graph ${msg.renderer}/${msg.layout ?? "layout"}/${msg.execution} layout started.`,
        );
        return;
      }
      if (msg.type === "graphforge/layoutReady") {
        ResultGraphPanel.lifecycleEmitter.fire(msg);
        console.info(
          `[GraphForge] Result Graph ${msg.renderer}/${msg.layout ?? "layout"}/${msg.execution} layout ready (${Math.round(msg.durationMs)} ms).`,
        );
        return;
      }
      if (msg.type === "graphforge/renderReady") {
        ResultGraphPanel.lifecycleEmitter.fire(msg);
        console.info(
          `[GraphForge] Result Graph ${msg.renderer}/${msg.backend ?? "default"} ready (${msg.nodeCount} nodes, ${msg.edgeCount} edges, ${Math.round(msg.durationMs)} ms).`,
        );
        return;
      }
      if (msg.type === "graphforge/timebarChanged") {
        ResultGraphPanel.timebarEmitter.fire({ values: msg.values });
        if (this.artifact) {
          const draft = this.artifact.state.draft;
          if (draft.graph.timebar.enabled) {
            this.artifact.state.update({
              ...draft,
              graph: {
                ...draft.graph,
                timebar: {
                  ...draft.graph.timebar,
                  range: {
                    start: new Date(msg.values[0]).toISOString(),
                    end: new Date(msg.values[1]).toISOString(),
                  },
                },
              },
            });
            if (this.viewOptions.timebar?.enabled) {
              this.viewOptions = {
                ...this.viewOptions,
                timebar: { ...this.viewOptions.timebar, values: msg.values },
              };
            }
            this.postArtifactState();
          }
        }
        return;
      }
      if (msg.type === "graphforge/saveGraphArtifactState") {
        if (this.artifact) {
          try {
            replaceProjectVisualization(
              this.artifact.projectRoot,
              this.artifact.path,
              this.artifact.state.draft,
            );
            this.artifact.state.commit();
            this.artifact.onSaved?.();
            this.artifact.committedValues = this.viewOptions.timebar?.enabled
              ? [...this.viewOptions.timebar.values] as [number, number]
              : undefined;
          } catch (error) {
            void vscode.window.showErrorMessage(
              `GraphForge could not save the visualization: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
          this.postArtifactState();
        }
        return;
      }
      if (msg.type === "graphforge/revertGraphArtifactState") {
        if (this.artifact) {
          this.artifact.state.revert();
          if (this.viewOptions.timebar?.enabled && this.artifact.committedValues) {
            this.viewOptions = {
              ...this.viewOptions,
              timebar: {
                ...this.viewOptions.timebar,
                values: [...this.artifact.committedValues] as [number, number],
              },
            };
            this.postOptions();
          }
          this.postArtifactState();
        }
        return;
      }
      const selection = resolveGraphSelection(this.payload, msg);
      if (selection) {
        ResultGraphPanel.selectionEmitter.fire(selection);
        EntityInspectPanel.show(
          this.extensionUri,
          selection,
          selection.openInNewTab === true,
        );
      }
    });
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("graphforge.resultGraph.renderer")) {
          this.postRenderer();
        }
      }),
    );
    this.panel.webview.html = this.getHtml(this.panel.webview, extensionUri);
  }

  static async show(
    extensionUri: vscode.Uri,
    payload?: GraphPayload,
    options: ResultGraphViewOptions = {},
    instance: ResultGraphInstanceOptions = {},
  ): Promise<{ panel: ResultGraphPanel; status: "opened" | "updated" | "cancelled" }> {
    const instanceId = instance.instanceId ?? visualizationInstanceId("graph");
    const existing = visualizationInstances.get<ResultGraphPanel>(instanceId);
    if (existing) {
      existing.reveal();
      if (existing.artifact?.state.dirty) {
        const choice = await vscode.window.showWarningMessage(
          "This result graph has unsaved artifact changes. Discard them and open the requested graph?",
          { modal: true },
          "Discard changes",
        );
        if (choice !== "Discard changes") {
          return { panel: existing, status: "cancelled" };
        }
      }
      existing.detachArtifact();
      existing.setViewOptions(options);
      if (payload) {
        existing.update(payload);
      }
      return { panel: existing, status: "updated" };
    }

    const showOptions = graphForgeVizShowOptions();
    const panel = vscode.window.createWebviewPanel(
      "graphforge.resultGraph",
      "GraphForge Result Graph",
      showOptions,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist", "webview-ui")],
      },
    );
    const created = visualizationInstances.register(
      new ResultGraphPanel(panel, extensionUri, instanceId, instance.coordinationGroup),
    );
    created.setViewOptions(options);
    if (payload) {
      created.update(payload);
    }
    return { panel: created, status: "opened" };
  }

  static active(): ResultGraphPanel | undefined {
    return visualizationInstances.active<ResultGraphPanel>("graph");
  }

  static instances(): ResultGraphPanel[] {
    return visualizationInstances.values<ResultGraphPanel>("graph");
  }

  reveal(): void {
    visualizationInstances.activate(this.instanceId);
    revealVizPanel(this.panel);
  }

  dispose(): void {
    this.panel.dispose();
  }

  update(payload: GraphPayload): void {
    this.lifecycle.beginRender();
    this.payload = payload;
    this.panel.title = payload.title
      ? `GraphForge: ${payload.title}`
      : "GraphForge Result Graph";
    this.postGraph(payload);
  }

  attachArtifact(
    projectRoot: string,
    artifactPath: string,
    spec: ResultGraphVisualizationSpecV2,
    onSaved?: () => void,
  ): void {
    this.artifact = {
      projectRoot,
      path: artifactPath,
      state: new VisualizationDocumentState(spec),
      onSaved,
      committedValues: this.viewOptions.timebar?.enabled
        ? [...this.viewOptions.timebar.values] as [number, number]
        : undefined,
    };
    this.postArtifactState();
  }

  private detachArtifact(): void {
    this.artifact = undefined;
    this.postArtifactState();
  }

  private setViewOptions(options: ResultGraphViewOptions): void {
    this.viewOptions = options;
    // The caller posts the graph immediately after these settings. Suppress
    // intermediate renders of the previous payload; the graph message applies
    // the complete renderer/options/payload snapshot once.
    this.postRenderer(false);
    this.postOptions(false);
  }

  highlightFromResult(
    result: QueryResult,
    rowIndex: number,
    column?: string,
  ): GraphElementHighlight {
    const highlight = resolveResultGraphHighlight(
      result,
      this.payload,
      rowIndex,
      column,
    );
    if (highlight.nodeIds.length > 0 || highlight.edgeIds.length > 0) {
      const message: HostToWebview = {
        type: "graphforge/highlightGraphElements",
        ...highlight,
      };
      void this.panel.webview.postMessage(message);
    }
    return highlight;
  }

  private postRenderer(render = true): void {
    if (!this.webviewReady) return;
    const configured = vscode.workspace
      .getConfiguration("graphforge")
      .get("resultGraph.renderer");
    const msg: HostToWebview = {
      type: "graphforge/graphRenderer",
      renderer: this.viewOptions.renderer ?? normalizeResultGraphRenderer(configured),
      render,
    };
    void this.panel.webview.postMessage(msg);
  }

  private postContext(): void {
    const msg: HostToWebview = {
      type: "graphforge/visualizationContext",
      instanceId: this.instanceId,
      renderGeneration: this.renderGeneration,
    };
    void this.panel.webview.postMessage(msg);
  }

  private postOptions(render = true): void {
    if (!this.webviewReady) return;
    const msg: HostToWebview = {
      type: "graphforge/graphOptions",
      render,
      backend: this.viewOptions.backend,
      source: this.viewOptions.source,
      layout: this.viewOptions.layout,
      visualDensity: this.viewOptions.visualDensity,
      labels: this.viewOptions.labels,
      timebar: this.viewOptions.timebar,
    };
    void this.panel.webview.postMessage(msg);
  }

  private postArtifactState(): void {
    if (!this.webviewReady) return;
    const msg: HostToWebview = {
      type: "graphforge/graphArtifactState",
      saved: Boolean(this.artifact),
      dirty: this.artifact?.state.dirty ?? false,
    };
    void this.panel.webview.postMessage(msg);
  }

  private postGraph(payload: GraphPayload): void {
    if (!this.webviewReady) return;
    this.postContext();
    const msg: HostToWebview = { type: "graphforge/graph", payload };
    void this.panel.webview.postMessage(msg);
  }

  private getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const assetsRoot = vscode.Uri.joinPath(extensionUri, "dist", "webview-ui");
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(assetsRoot, "resultGraph.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(assetsRoot, "resultGraph.css"),
    );
    const loadingStyleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(assetsRoot, "visualizationLoading.css"),
    );
    const nonce = crypto.randomBytes(16).toString("base64url");
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data: blob:`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource} data:`,
      `script-src 'nonce-${nonce}'`,
      `worker-src ${webview.cspSource} blob:`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <link rel="stylesheet" href="${loadingStyleUri}" />
  <title>GraphForge Result Graph</title>
</head>
<body>
  <main id="app">
    <header>
      <div class="title-row">
        <div>
          <h1 id="title">Result Graph</h1>
          <span id="renderer-label" class="renderer-label"></span>
        </div>
        <div class="toolbar" role="toolbar" aria-label="Graph view controls">
          <button id="fit" type="button" title="Fit graph to view">Fit</button>
          <button id="relayout" type="button" title="Run force layout again">Re-layout</button>
          <button id="save-artifact" type="button" hidden disabled>Save</button>
          <button id="revert-artifact" type="button" hidden disabled>Revert</button>
        </div>
      </div>
      <div class="legend" id="status-legend" aria-label="Epistemic status legend"></div>
      <div class="legend" id="type-legend" aria-label="Graph class legend"></div>
      <p class="banner" id="banner" hidden role="status" aria-live="polite"></p>
    </header>
    <section id="canvas-wrap" aria-label="Interactive result graph">
      <div id="graph" tabindex="0" aria-label="Pan and zoom the result graph"></div>
      <div class="render-status" id="render-status" role="status" aria-live="polite" aria-atomic="true" hidden>
        <div class="render-status-card">
          <p class="render-status-renderer" data-render-status-renderer>Render pipeline</p>
          <h2 class="render-status-title" data-render-status-title>Preparing graph</h2>
          <p class="render-status-detail" data-render-status-detail></p>
          <ol class="render-status-steps" data-render-status-steps aria-label="Render stages"></ol>
        </div>
      </div>
      <p class="empty" id="empty">Waiting for graph data…</p>
    </section>
    <footer id="footer"><span id="render-summary">Waiting for graph data</span><span aria-hidden="true"> · </span><span id="style-summary">Colors are extension-owned; styling is epistemic when the ledger is resolvable.</span></footer>
  </main>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
