import * as crypto from "node:crypto";
import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import type { GraphPayload, QueryResult } from "../session/types";
import type { ResultDocumentPaths } from "../session/resultDocument";
import type { HostToWebview, WebviewToHost } from "../webview/protocol";
import { EntityInspectPanel } from "../webview/entityInspectPanel";
import { ResultGraphPanel } from "../webview/resultGraphPanel";
import {
  jsonSafeQueryResult,
  resolveResultEntitySelection,
  resultEntityLinksByRow,
  resultRowsForGraphSelection,
} from "../webview/resultTableModel";

export const RESULTS_VIEW_CONTAINER_ID = "graphforgeResults";
export const RESULTS_VIEW_ID = "graphforge.results";

interface ResultTableState {
  title: string;
  result: QueryResult;
  persisted?: ResultDocumentPaths;
  graphPayload?: GraphPayload;
}

/** Interactive query/verb table hosted in VS Code's bottom Panel area. */
export class ResultTableViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private view: vscode.WebviewView | undefined;
  private state: ResultTableState | undefined;
  private readonly graphSelectionDisposable: vscode.Disposable;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly session: GraphForgeSession,
  ) {
    this.graphSelectionDisposable = ResultGraphPanel.onDidSelect((selection) => {
      if (!this.state) return;
      const rowIndices = resultRowsForGraphSelection(this.state.result, selection);
      if (rowIndices.length === 0) return;
      void this.reveal();
      this.post({ type: "graphforge/highlightResultRows", rowIndices });
    });
  }

  dispose(): void {
    this.graphSelectionDisposable.dispose();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "dist", "webview-ui"),
      ],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message: WebviewToHost) => {
      if (message.type === "graphforge/ready") {
        this.postState();
      } else if (message.type === "graphforge/selectResult") {
        this.selectResult(message.rowIndex, message.column);
      } else if (message.type === "graphforge/openResultEntity") {
        this.openResultEntity(message.kind, message.id, message.shiftKey === true);
      } else if (message.type === "graphforge/openResultDocument") {
        void this.openPersistedDocument(message.kind);
      }
    });
    this.postState();
  }

  async show(
    result: QueryResult,
    title: string,
    persisted?: ResultDocumentPaths,
  ): Promise<void> {
    const safeResult = jsonSafeQueryResult(result);
    let graphPayload: GraphPayload | undefined;
    try {
      graphPayload = await this.session.toGraphPayload(safeResult, title);
    } catch {
      // The table remains useful when graph projection/status resolution fails.
    }
    this.state = {
      title,
      result: safeResult,
      persisted,
      graphPayload,
    };
    this.postState();
    await this.reveal();
    this.postState();
  }

  /** Link a visualization's accessible companion row through the Results surface. */
  selectRow(rowIndex: number): void {
    this.selectResult(rowIndex);
  }

  /** Reopen the Results panel from persistent workbench controls. */
  async reveal(): Promise<void> {
    await vscode.commands.executeCommand(
      `workbench.view.extension.${RESULTS_VIEW_CONTAINER_ID}`,
    );
    await vscode.commands.executeCommand(`${RESULTS_VIEW_ID}.focus`);
  }

  private selectResult(rowIndex: number, column?: string): void {
    if (!this.state) return;
    const graphPanel = ResultGraphPanel.active();
    const highlight = graphPanel?.highlightFromResult(
      this.state.result,
      rowIndex,
      column,
    );
    const count =
      (highlight?.nodeIds.length ?? 0) + (highlight?.edgeIds.length ?? 0);
    this.post({
      type: "graphforge/resultSelection",
      linked: count > 0,
      message: !graphPanel
        ? "Open Result Graph to link this selection."
        : count > 0
          ? `Highlighted ${highlight?.nodeIds.length ?? 0} node(s) and ${highlight?.edgeIds.length ?? 0} edge(s).`
          : "No graph entity matched this value or row.",
    });
  }

  private openResultEntity(
    kind: "node" | "edge",
    id: string,
    openInNewTab: boolean,
  ): void {
    const selection = resolveResultEntitySelection(
      this.state?.graphPayload,
      kind,
      id,
    );
    if (!selection) {
      this.post({
        type: "graphforge/resultSelection",
        linked: false,
        message: "That entity is no longer available in the current result.",
      });
      return;
    }
    EntityInspectPanel.show(this.extensionUri, selection, openInNewTab);
    this.post({
      type: "graphforge/resultSelection",
      linked: true,
      message: `Opened ${kind} ${id} in Entity Inspect${openInNewTab ? " (new tab)" : ""}.`,
    });
  }

  private async openPersistedDocument(
    kind: "json" | "markdown",
  ): Promise<void> {
    const path =
      kind === "json"
        ? this.state?.persisted?.jsonPath
        : this.state?.persisted?.markdownPath;
    if (!path) return;
    const uri = vscode.Uri.file(path);
    if (kind === "markdown") {
      await vscode.commands.executeCommand("markdown.showPreviewToSide", uri);
      return;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true,
    });
  }

  private postState(): void {
    if (!this.state || !this.view) return;
    this.view.description = `${this.state.result.rowCount} row(s)`;
    this.post({
      type: "graphforge/results",
      title: this.state.title,
      result: this.state.result,
      persisted: this.state.persisted,
      entityLinks: resultEntityLinksByRow(
        this.state.result,
        this.state.graphPayload,
      ),
    });
  }

  private post(message: HostToWebview): void {
    void this.view?.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const assetsRoot = vscode.Uri.joinPath(
      this.extensionUri,
      "dist",
      "webview-ui",
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(assetsRoot, "results.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(assetsRoot, "results.css"),
    );
    const nonce = crypto.randomBytes(16).toString("base64url");
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>GraphForge Results</title>
</head>
<body>
  <main id="app">
    <header>
      <div>
        <h1 id="title">Query results</h1>
        <p id="summary">Run a query to populate this table.</p>
      </div>
      <div id="document-actions" class="actions" hidden>
        <button id="open-json" type="button">JSON</button>
        <button id="open-markdown" type="button">Markdown</button>
      </div>
    </header>
    <p id="link-status" class="link-status" role="status" aria-live="polite">
      Select a row or cell to highlight its matching Result Graph entity.
    </p>
    <section id="table-wrap" aria-label="Query result table">
      <p id="empty" class="empty">Run a query to see tabular results here.</p>
      <table id="results-table" hidden>
        <thead id="table-head"></thead>
        <tbody id="table-body"></tbody>
      </table>
    </section>
    <footer id="footer" hidden>
      <span id="render-count"></span>
      <button id="load-more" type="button" hidden>Show more rows</button>
    </footer>
  </main>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
