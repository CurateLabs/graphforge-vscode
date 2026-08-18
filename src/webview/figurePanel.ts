import * as crypto from "node:crypto";
import * as vscode from "vscode";
import type {
  FigureHostToWebview,
  FigureWebviewToHost,
  PlotlyFigure,
} from "./figureSchema";
import {
  graphForgeVizShowOptions,
  revealVizPanel,
  trackVizPanel,
} from "./panelColumn";
import {
  visualizationInstanceId,
  visualizationInstances,
  VisualizationInstanceLifecycle,
  type VisualizationController,
} from "./visualizationInstanceRegistry";

/**
 * GraphForge Figure panel (#62): Vite-built plotly.js surface.
 * Host only serves shell HTML and posts figure JSON — never eval.
 */
export class FigurePanel implements VisualizationController {
  public readonly kind = "figure" as const;
  public readonly coordinationGroup = undefined;
  private readonly lifecycle: VisualizationInstanceLifecycle;
  public get renderGeneration(): number { return this.lifecycle.renderGeneration; }
  private readonly panel: vscode.WebviewPanel;
  private figure: PlotlyFigure | undefined;
  private errorMessage: string | undefined;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    public readonly instanceId: string,
  ) {
    this.lifecycle = new VisualizationInstanceLifecycle(instanceId);
    this.panel = panel;
    trackVizPanel(panel);
    this.panel.onDidDispose(() => {
      visualizationInstances.remove(this.instanceId);
      this.lifecycle.dispose();
    });
    this.panel.webview.onDidReceiveMessage((msg: FigureWebviewToHost) => {
      if (msg.type === "graphforge/ready") {
        this.repost();
      } else if (!this.lifecycle.accepts(msg)) {
        return;
      } else if (msg.type === "graphforge/renderFailed") {
        this.errorMessage = msg.message;
      }
    });
    this.panel.webview.html = this.getHtml(this.panel.webview, extensionUri);
  }

  static show(
    extensionUri: vscode.Uri,
    figure?: PlotlyFigure,
    instanceId = visualizationInstanceId("figure"),
  ): { panel: FigurePanel; status: "opened" | "updated" } {
    const existing = visualizationInstances.get<FigurePanel>(instanceId);
    if (existing) {
      existing.reveal();
      if (figure) {
        existing.update(figure);
      }
      return { panel: existing, status: "updated" };
    }
    const showOptions = graphForgeVizShowOptions();
    const panel = vscode.window.createWebviewPanel(
      "graphforge.figure",
      "GraphForge Figure",
      showOptions,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist", "webview-ui")],
      },
    );
    const created = visualizationInstances.register(new FigurePanel(panel, extensionUri, instanceId));
    if (figure) {
      created.update(figure);
    }
    return { panel: created, status: "opened" };
  }

  reveal(): void {
    visualizationInstances.activate(this.instanceId);
    revealVizPanel(this.panel);
  }

  dispose(): void {
    this.panel.dispose();
  }

  update(figure: PlotlyFigure): void {
    this.lifecycle.beginRender();
    this.figure = figure;
    this.errorMessage = undefined;
    this.panel.title = figureTitle(figure);
    this.repost();
  }

  showError(message: string): void {
    this.lifecycle.beginRender();
    this.errorMessage = message;
    this.figure = undefined;
    this.repost();
  }

  private repost(): void {
    if (this.errorMessage) {
      const msg: FigureHostToWebview = {
        ...this.messageContext,
        type: "graphforge/figureError",
        message: this.errorMessage,
      };
      void this.panel.webview.postMessage(msg);
      return;
    }
    if (this.figure) {
      const msg: FigureHostToWebview = { ...this.messageContext, type: "graphforge/figure", figure: this.figure };
      void this.panel.webview.postMessage(msg);
    }
  }

  private get messageContext(): { instanceId: string; renderGeneration: number } {
    return { instanceId: this.instanceId, renderGeneration: this.renderGeneration };
  }

  private getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const assetsRoot = vscode.Uri.joinPath(extensionUri, "dist", "webview-ui");
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, "figure.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, "figure.css"));
    const loadingStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, "visualizationLoading.css"));
    const nonce = crypto.randomBytes(16).toString("base64url");
    // Settings-strict CSP: scripts by nonce only; styles from extension +
    // bundled plotly.css (no CDN, no style-src unsafe-inline as success path).
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
  <title>GraphForge Figure</title>
</head>
<body>
  <div id="app">
    <p id="banner" hidden role="alert" aria-live="assertive"></p>
    <div id="plot"></div>
    <div class="render-status" id="render-status" role="status" aria-live="polite" aria-atomic="true" hidden>
      <div class="render-status-card">
        <p class="render-status-renderer" data-render-status-renderer>Render pipeline</p>
        <h1 class="render-status-title" data-render-status-title>Preparing figure</h1>
        <p class="render-status-detail" data-render-status-detail></p>
        <ol class="render-status-steps" data-render-status-steps aria-label="Render stages"></ol>
      </div>
    </div>
  </div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

const MAX_TITLE_LENGTH = 60;

function normalizeTitle(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "GraphForge Figure";
  }
  const clipped =
    compact.length > MAX_TITLE_LENGTH
      ? `${compact.slice(0, MAX_TITLE_LENGTH - 1)}…`
      : compact;
  return `GraphForge: ${clipped}`;
}

function figureTitle(figure: PlotlyFigure): string {
  const layout = figure.layout;
  const title = layout?.title;
  if (typeof title === "string") {
    return normalizeTitle(title);
  }
  if (
    title &&
    typeof title === "object" &&
    typeof (title as { text?: unknown }).text === "string"
  ) {
    return normalizeTitle((title as { text: string }).text);
  }
  return "GraphForge Figure";
}
