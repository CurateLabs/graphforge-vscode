import * as crypto from "node:crypto";
import * as vscode from "vscode";
import {
  isVisualizationSpecV2,
  type ProjectVisualizationSpecV2,
} from "../session/visualizationRegistry";
import { replaceProjectVisualization } from "../session/projectArtifacts";
import type { QueryResult } from "../session/types";
import { VisualizationDocumentState } from "../session/visualizationDocumentState";
import {
  graphForgeVizShowOptions,
  revealVizPanel,
  trackVizPanel,
} from "./panelColumn";
import type {
  ArtifactVisualizationHostToWebview,
  ArtifactVisualizationSpec,
  ArtifactVisualizationWebviewToHost,
} from "./artifactVisualizationProtocol";

function isRenderableSpec(value: unknown): value is ArtifactVisualizationSpec {
  return (
    isVisualizationSpecV2(value) &&
    (value.kind === "chart" || value.kind === "geospatial" || value.kind === "temporal")
  );
}

function rendererId(spec: ArtifactVisualizationSpec): string {
  return spec.renderer.id;
}

function immutableIdentityMatches(
  committed: ArtifactVisualizationSpec,
  draft: ArtifactVisualizationSpec,
): boolean {
  return (
    committed.format === draft.format &&
    committed.name === draft.name &&
    committed.kind === draft.kind &&
    committed.result === draft.result &&
    rendererId(committed) === rendererId(draft)
  );
}

export class ArtifactVisualizationPanel {
  public static current: ArtifactVisualizationPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private projectRoot: string;
  private artifactPath: string;
  private result: QueryResult;
  private state: VisualizationDocumentState<ArtifactVisualizationSpec>;
  private onSaved: (() => void) | undefined;
  private onSelectRow: ((rowIndex: number) => void) | undefined;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    projectRoot: string,
    artifactPath: string,
    spec: ArtifactVisualizationSpec,
    result: QueryResult,
    onSaved?: () => void,
    onSelectRow?: (rowIndex: number) => void,
  ) {
    this.panel = panel;
    this.projectRoot = projectRoot;
    this.artifactPath = artifactPath;
    this.result = result;
    this.state = new VisualizationDocumentState(spec);
    this.onSaved = onSaved;
    this.onSelectRow = onSelectRow;
    trackVizPanel(panel);
    this.panel.onDidDispose(() => {
      ArtifactVisualizationPanel.current = undefined;
      for (const disposable of this.disposables.splice(0)) disposable.dispose();
    });
    this.panel.webview.onDidReceiveMessage((message: ArtifactVisualizationWebviewToHost) => {
      void this.receive(message);
    });
    this.panel.webview.html = this.getHtml(this.panel.webview, extensionUri);
    this.updateTitle();
  }

  static async show(
    extensionUri: vscode.Uri,
    projectRoot: string,
    artifactPath: string,
    spec: ArtifactVisualizationSpec,
    result: QueryResult,
    onSaved?: () => void,
    onSelectRow?: (rowIndex: number) => void,
  ): Promise<{ panel: ArtifactVisualizationPanel; status: "opened" | "updated" | "cancelled" }> {
    if (ArtifactVisualizationPanel.current) {
      revealVizPanel(ArtifactVisualizationPanel.current.panel);
      if (ArtifactVisualizationPanel.current.state.dirty) {
        const choice = await vscode.window.showWarningMessage(
          "This visualization has unsaved artifact changes. Discard them and open the requested visualization?",
          { modal: true },
          "Discard changes",
        );
        if (choice !== "Discard changes") {
          return { panel: ArtifactVisualizationPanel.current, status: "cancelled" };
        }
      }
      ArtifactVisualizationPanel.current.replace(
        projectRoot,
        artifactPath,
        spec,
        result,
        onSaved,
        onSelectRow,
      );
      return { panel: ArtifactVisualizationPanel.current, status: "updated" };
    }
    const panel = vscode.window.createWebviewPanel(
      "graphforge.artifactVisualization",
      "GraphForge Visualization",
      graphForgeVizShowOptions(),
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist", "webview-ui")],
      },
    );
    const created = new ArtifactVisualizationPanel(
      panel,
      extensionUri,
      projectRoot,
      artifactPath,
      spec,
      result,
      onSaved,
      onSelectRow,
    );
    ArtifactVisualizationPanel.current = created;
    return { panel: created, status: "opened" };
  }

  private replace(
    projectRoot: string,
    artifactPath: string,
    spec: ArtifactVisualizationSpec,
    result: QueryResult,
    onSaved?: () => void,
    onSelectRow?: (rowIndex: number) => void,
  ): void {
    this.projectRoot = projectRoot;
    this.artifactPath = artifactPath;
    this.result = result;
    this.state = new VisualizationDocumentState(spec);
    this.onSaved = onSaved;
    this.onSelectRow = onSelectRow;
    this.updateTitle();
    this.postCurrent();
  }

  private updateTitle(): void {
    const spec = this.state.draft;
    const label = spec.kind === "geospatial" ? "Map" : spec.kind === "temporal" ? "Timeline" : "Chart";
    this.panel.title = `GraphForge: ${spec.name || label}`;
  }

  private postCurrent(): void {
    const message: ArtifactVisualizationHostToWebview = {
      type: "graphforge/artifactVisualization",
      path: this.artifactPath,
      spec: this.state.draft,
      result: this.result,
      dirty: this.state.dirty,
    };
    void this.panel.webview.postMessage(message);
  }

  private async receive(message: ArtifactVisualizationWebviewToHost): Promise<void> {
    if (message.type === "graphforge/ready") {
      this.postCurrent();
      return;
    }
    if (message.type === "graphforge/renderStarted") {
      console.info(`[GraphForge] Visualization ${message.kind}/${message.renderer} render started.`);
      return;
    }
    if (message.type === "graphforge/selectResult") {
      this.onSelectRow?.(message.rowIndex);
      return;
    }
    if (message.type === "graphforge/renderReady") {
      console.info(
        `[GraphForge] Visualization ${message.kind}/${message.renderer} ready (${message.rowCount} rows, ${Math.round(message.durationMs)} ms).`,
      );
      return;
    }
    if (message.type === "graphforge/renderFailed") {
      console.error(
        `[GraphForge] Visualization ${message.kind}/${message.renderer}/${message.phase} failed (${message.code}): ${message.message}`,
      );
      return;
    }
    if (message.type === "graphforge/artifactStateChanged") {
      const candidate: ProjectVisualizationSpecV2 = message.spec;
      if (!isRenderableSpec(candidate) || !immutableIdentityMatches(this.state.committed, candidate)) {
        const response: ArtifactVisualizationHostToWebview = {
          type: "graphforge/artifactError",
          message: "The visualization proposed an invalid or identity-changing artifact state.",
        };
        void this.panel.webview.postMessage(response);
        return;
      }
      this.state.update(candidate);
      const response: ArtifactVisualizationHostToWebview = {
        type: "graphforge/artifactDirty",
        dirty: this.state.dirty,
      };
      void this.panel.webview.postMessage(response);
      return;
    }
    if (message.type === "graphforge/revertArtifactState") {
      const spec = this.state.revert();
      const response: ArtifactVisualizationHostToWebview = {
        type: "graphforge/artifactReverted",
        spec,
      };
      void this.panel.webview.postMessage(response);
      this.postCurrent();
      return;
    }
    if (message.type === "graphforge/saveArtifactState") {
      try {
        const spec = this.state.draft;
        replaceProjectVisualization(this.projectRoot, this.artifactPath, spec);
        this.state.commit();
        this.onSaved?.();
        const response: ArtifactVisualizationHostToWebview = {
          type: "graphforge/artifactCommitted",
          spec,
        };
        void this.panel.webview.postMessage(response);
      } catch (error) {
        const response: ArtifactVisualizationHostToWebview = {
          type: "graphforge/artifactError",
          message: error instanceof Error ? error.message : String(error),
        };
        void this.panel.webview.postMessage(response);
      }
    }
  }

  private getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const assetsRoot = vscode.Uri.joinPath(extensionUri, "dist", "webview-ui");
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, "artifactVisualization.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, "artifactVisualization.css"));
    const loadingStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, "visualizationLoading.css"));
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
  <title>GraphForge Visualization</title>
</head>
<body>
  <main id="app">
    <header>
      <div><h1 id="title">Visualization</h1><div class="meta"><span id="artifact-identity"></span><span aria-hidden="true"> · </span><span id="render-summary">Waiting for visualization data</span></div></div>
      <div class="toolbar" role="toolbar" aria-label="Artifact controls">
        <button id="save" type="button" disabled>Save</button>
        <button id="revert" type="button" disabled>Revert</button>
      </div>
    </header>
    <section id="visualization-wrap" aria-label="Visualization">
      <p id="banner" role="alert" aria-live="assertive" hidden></p>
      <div id="visualization"></div>
      <div class="render-status" id="render-status" role="status" aria-live="polite" aria-atomic="true" hidden>
        <div class="render-status-card">
          <p class="render-status-renderer" data-render-status-renderer>Render pipeline</p>
          <h2 class="render-status-title" data-render-status-title>Preparing visualization</h2>
          <p class="render-status-detail" data-render-status-detail></p>
          <ol class="render-status-steps" data-render-status-steps aria-label="Render stages"></ol>
        </div>
      </div>
    </section>
    <section id="temporal-controls" hidden aria-label="Temporal range controls">
      <label>Range start (ISO 8601)<input id="range-start" type="text" placeholder="2026-01-01T00:00:00Z" /></label>
      <label>Range end (ISO 8601)<input id="range-end" type="text" placeholder="2026-12-31T23:59:59Z" /></label>
      <div class="toolbar"><button id="play" type="button">Play</button><button id="pause" type="button">Pause</button></div>
    </section>
    <details id="accessible-summary" open>
      <summary id="summary">Accessible data</summary>
      <div id="table-wrap"></div>
    </details>
  </main>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
