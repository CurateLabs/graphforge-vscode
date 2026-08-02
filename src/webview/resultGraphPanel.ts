import * as crypto from "node:crypto";
import * as vscode from "vscode";
import type { GraphPayload, QueryResult } from "../session/types";
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

export class ResultGraphPanel {
  public static current: ResultGraphPanel | undefined;
  private static readonly selectionEmitter =
    new vscode.EventEmitter<GraphSelection>();
  public static readonly onDidSelect = ResultGraphPanel.selectionEmitter.event;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private payload: GraphPayload | undefined;
  private viewOptions: ResultGraphViewOptions = {};

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.panel = panel;
    trackVizPanel(panel);
    this.panel.onDidDispose(() => {
      ResultGraphPanel.current = undefined;
      for (const disposable of this.disposables.splice(0)) {
        disposable.dispose();
      }
    });
    this.panel.webview.onDidReceiveMessage((msg: WebviewToHost) => {
      if (msg.type === "graphforge/ready") {
        this.postRenderer();
        this.postOptions();
        if (this.payload) {
          this.postGraph(this.payload);
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

  static show(
    extensionUri: vscode.Uri,
    payload?: GraphPayload,
    options: ResultGraphViewOptions = {},
  ): ResultGraphPanel {
    if (ResultGraphPanel.current) {
      revealVizPanel(ResultGraphPanel.current.panel);
      ResultGraphPanel.current.setViewOptions(options);
      if (payload) {
        ResultGraphPanel.current.update(payload);
      }
      return ResultGraphPanel.current;
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
    ResultGraphPanel.current = new ResultGraphPanel(panel, extensionUri);
    ResultGraphPanel.current.setViewOptions(options);
    if (payload) {
      ResultGraphPanel.current.update(payload);
    }
    return ResultGraphPanel.current;
  }

  update(payload: GraphPayload): void {
    this.payload = payload;
    this.panel.title = payload.title
      ? `GraphForge: ${payload.title}`
      : "GraphForge Result Graph";
    this.postGraph(payload);
  }

  private setViewOptions(options: ResultGraphViewOptions): void {
    this.viewOptions = options;
    this.postRenderer();
    this.postOptions();
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

  private postRenderer(): void {
    const configured = vscode.workspace
      .getConfiguration("graphforge")
      .get("resultGraph.renderer");
    const msg: HostToWebview = {
      type: "graphforge/graphRenderer",
      renderer: this.viewOptions.renderer ?? normalizeResultGraphRenderer(configured),
    };
    void this.panel.webview.postMessage(msg);
  }

  private postOptions(): void {
    const msg: HostToWebview = {
      type: "graphforge/graphOptions",
      layout: this.viewOptions.layout,
    };
    void this.panel.webview.postMessage(msg);
  }

  private postGraph(payload: GraphPayload): void {
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
        </div>
      </div>
      <div class="legend" id="status-legend" aria-label="Epistemic status legend"></div>
      <div class="legend" id="type-legend" aria-label="Graph class legend"></div>
      <p class="banner" id="banner" hidden role="status" aria-live="polite"></p>
    </header>
    <section id="canvas-wrap" aria-label="Interactive result graph">
      <div id="graph" tabindex="0" aria-label="Pan and zoom the result graph"></div>
      <p class="empty" id="empty">Waiting for graph data…</p>
    </section>
    <footer id="footer">Colors are extension-owned. Epistemic when the knowledge ledger is resolvable, otherwise class-only.</footer>
  </main>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
