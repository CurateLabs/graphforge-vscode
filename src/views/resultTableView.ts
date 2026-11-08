import * as crypto from "node:crypto";
import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import type { GraphPayload, QueryResult } from "../session/types";
import type { ResultDocumentPaths } from "../session/resultDocument";
import { queryResultPage, resultIdentity, type ResultPage } from "../session/resultRows";
import type { HostToWebview, WebviewToHost } from "../webview/protocol";
import { EntityInspectPanel } from "../webview/entityInspectPanel";
import { XygVisualizationPanel } from "../webview/xygPanel";
import {
  RESULT_INSPECT_NOTICE,
  resultPageContainsRow, resultPageSelection, resultMessageMatches,
  resolveResultEntitySelection, resultEntityLinksByRow, resultRowsForGraphSelection,
} from "../webview/resultTableModel";

export const RESULTS_VIEW_CONTAINER_ID = "graphforgeResults";
export const RESULTS_VIEW_ID = "graphforge.results";

interface ResultTableState {
  title: string;
  source: QueryResult;
  resultId: string;
  revision: number;
  pageVersion: number;
  loading: boolean;
  projectRoot: string | undefined;
  project: GraphForgeSession["project"];
  page?: ResultPage;
  persisted?: ResultDocumentPaths;
  graphPayload?: GraphPayload;
  entityLinks?: ReturnType<typeof resultEntityLinksByRow>;
  selectedRows: Set<number>;
  error?: string;
  inspectNotice?: string;
}

type ResultContext = { resultId: string; revision: number; pageVersion: number };

/** Interactive query/verb table: only the requested, bounded page crosses the webview boundary. */
export class ResultTableViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private state: ResultTableState | undefined;
  private revision = 0;
  private disposed = false;
  private readonly graphSelectionDisposable: vscode.Disposable;

  constructor(private readonly extensionUri: vscode.Uri, private readonly session: GraphForgeSession) {
    this.graphSelectionDisposable = vscode.Disposable.from(
      XygVisualizationPanel.onDidSelect(selection => {
        const state = this.state;
        if (!state || state.source !== selection.source || this.session.project?.rootPath !== selection.projectRoot) return;
        // Native picks supply authoritative source membership. The legacy Inspect
        // fallback is intentionally restricted to the already decoded page.
        const rows = selection.rowIndices !== undefined
          ? resultRowsForGraphSelection(state.source, selection, selection.rowIndices)
          : state.page ? resultRowsForGraphSelection(state.page, selection).map(row => row + state.page!.offset) : [];
        void this.highlightRows(state, rows);
      }),
      this.session.onDidChange(() => {
        if (this.state && !this.isCurrent(this.state)) this.clearStaleState();
      }),
      XygVisualizationPanel.onDidSelectRows(selection => {
        const state = this.state;
        if (!state || state.source !== selection.source || this.session.project?.rootPath !== selection.projectRoot) return;
        void this.highlightRows(state, selection.rowIndices);
      }),
    );
  }

  dispose(): void { this.disposed = true; this.graphSelectionDisposable.dispose(); }

  resolveWebviewView(webviewView: vscode.WebviewView, _context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview-ui")] };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message: WebviewToHost) => {
      if (!message || typeof message !== "object") return;
      if (message.type === "graphforge/ready") { this.postState(); return; }
      const state = this.state;
      if (!state || state.loading || !this.isCurrent(state) || !resultMessageMatches(message, this.context(state))) return;
      if (message.type === "graphforge/requestResultPage") {
        void this.loadPage(state, message.offset, message.direction);
      } else if (message.type === "graphforge/selectResult") {
        if (state.page && resultPageContainsRow(state.page, message.rowIndex)) this.selectResult(message.rowIndex, message.column);
      } else if (message.type === "graphforge/openResultEntity") {
        this.openResultEntity(message.rowIndex, message.kind, message.id, message.shiftKey === true);
      } else if (message.type === "graphforge/openResultDocument") {
        void this.openPersistedDocument(message.kind);
      }
    });
    this.postState();
  }

  async show(result: QueryResult, title: string, persisted?: ResultDocumentPaths): Promise<void> {
    const state: ResultTableState = {
      title: title.slice(0, 512), source: result, resultId: resultIdentity(result), revision: ++this.revision,
      pageVersion: 0, loading: false, projectRoot: this.session.project?.rootPath, project: this.session.project, persisted, selectedRows: new Set(),
    };
    this.state = state;
    await this.loadPage(state, 0, "reset");
    if (!this.isCurrent(state)) return;
    await this.reveal();
    this.postState();
  }

  /** Trusted companion action; webview actions additionally carry page/result identity. */
  selectRow(rowIndex: number): void { this.selectResult(rowIndex); }

  async reveal(): Promise<void> {
    await vscode.commands.executeCommand(`workbench.view.extension.${RESULTS_VIEW_CONTAINER_ID}`);
    await vscode.commands.executeCommand(`${RESULTS_VIEW_ID}.focus`);
  }

  private context(state: ResultTableState): ResultContext {
    return { resultId: state.resultId, revision: state.revision, pageVersion: state.pageVersion };
  }

  private isCurrent(state: ResultTableState): boolean {
    return !this.disposed && this.state === state && this.session.project === state.project && this.session.project?.rootPath === state.projectRoot;
  }

  private clearStaleState(): void {
    const state = this.state;
    if (!state) return;
    this.state = undefined;
    if (this.view) this.view.description = "";
    this.post({ type: "graphforge/resultsCleared", resultId: state.resultId, revision: ++this.revision,
      pageVersion: state.pageVersion + 1, message: "Project changed. Run a query to see results." });
  }

  private async loadPage(state: ResultTableState, offset: number, direction: "next" | "previous" | "selection" | "reset" = "next", focusRow?: number): Promise<void> {
    if (!this.isCurrent(state)) return;
    const pageVersion = ++state.pageVersion;
    state.loading = true;
    state.error = undefined;
    this.post({ type: "graphforge/resultsLoading", ...this.context(state), title: state.title,
      rowCount: state.source.rowCount, persisted: Boolean(state.persisted), reset: direction === "reset" });
    try {
      const page = queryResultPage(state.source, offset);
      let graphPayload: GraphPayload | undefined;
      let entityLinks: ResultTableState["entityLinks"];
      let inspectNotice: string | undefined;
      try {
        // Inspect only needs this page's entities, never a host reconstruction
        // of every row in the original Arrow-backed result.
        graphPayload = await this.session.toGraphPayload({ columns: page.columns, rows: page.rows,
          rowCount: page.rows.length, generationUuid: page.generationUuid }, state.title);
        entityLinks = resultEntityLinksByRow(page, graphPayload, page.offset, true);
      } catch {
        graphPayload = undefined;
        entityLinks = undefined;
        inspectNotice = RESULT_INSPECT_NOTICE;
      }
      if (!this.isCurrent(state) || state.pageVersion !== pageVersion) return;
      state.loading = false;
      state.page = page;
      state.graphPayload = graphPayload;
      state.entityLinks = entityLinks;
      state.inspectNotice = inspectNotice;
      this.postState(direction, focusRow);
    } catch (error) {
      if (!this.isCurrent(state) || state.pageVersion !== pageVersion) return;
      state.loading = false;
      state.error = error instanceof Error ? error.message : "RESULT_PAGE_FAILED: Open the saved result document.";
      this.post({ type: "graphforge/resultsError", ...this.context(state), message: state.error });
    }
  }

  private async highlightRows(state: ResultTableState, rows: readonly number[]): Promise<void> {
    if (!this.isCurrent(state)) return;
    const cancelledPage = state.loading;
    if (cancelledPage) {
      ++state.pageVersion;
      state.loading = false;
    }
    state.error = undefined;
    const selection = new Set(rows.filter(row => Number.isSafeInteger(row) && row >= 0 && row < state.source.rowCount));
    state.selectedRows = selection;
    let first: number | undefined;
    for (const row of state.selectedRows) if (first === undefined || row < first) first = row;
    if (first !== undefined && (!state.page || !resultPageContainsRow(state.page, first))) {
      await this.loadPage(state, first, "selection", first);
    } else if (this.isCurrent(state) && state.page) {
      // A cancelled load advanced the context. Republish the retained page so
      // the browser leaves loading and accepts the newer pick or clear.
      if (cancelledPage) this.postState("selection", first);
      else this.postSelection(state, first);
    } else if (this.isCurrent(state)) {
      await this.loadPage(state, 0, "selection", first);
    }
    if (first !== undefined && this.isCurrent(state) && state.selectedRows === selection) void this.reveal();
  }

  private postSelection(state: ResultTableState, focusRow?: number): void {
    if (!state.page) return;
    this.post({ type: "graphforge/highlightResultRows", ...this.context(state),
      rowIndices: resultPageSelection(state.page, state.selectedRows), selectedCount: state.selectedRows.size, focusRow });
  }

  private selectResult(rowIndex: number, column?: string): void {
    const state = this.state;
    if (!state || state.loading || !this.isCurrent(state) || !Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex >= state.source.rowCount) return;
    state.selectedRows = new Set([rowIndex]);
    const graphPanel = XygVisualizationPanel.active();
    const highlight = graphPanel?.highlightFromResult(state.source, rowIndex, column);
    const graphCount = (highlight?.nodeIds.length ?? 0) + (highlight?.edgeIds.length ?? 0);
    const rowCount = (highlight as { rowIndices?: number[] } | undefined)?.rowIndices?.length ?? 0;
    this.post({ type: "graphforge/resultSelection", ...this.context(state), linked: graphCount > 0 || rowCount > 0,
      message: !graphPanel ? "Open a visualization to link this selection."
        : rowCount > 0 && graphCount === 0 ? `Highlighted ${rowCount} source row(s) in the visualization.`
        : graphCount > 0 ? `Highlighted ${highlight?.nodeIds.length ?? 0} node(s) and ${highlight?.edgeIds.length ?? 0} edge(s).`
        : "No visualization member matched this value or row." });
  }

  private openResultEntity(rowIndex: number, kind: "node" | "edge", id: string, openInNewTab: boolean): void {
    const state = this.state;
    if (!state?.page || state.loading || !this.isCurrent(state) || !resultPageContainsRow(state.page, rowIndex) ||
        !state.entityLinks?.[String(rowIndex)]?.some(link => link.kind === kind && link.id === id)) return;
    const selection = resolveResultEntitySelection(state.graphPayload, kind, id);
    if (!selection) return;
    state.selectedRows = new Set([rowIndex]);
    EntityInspectPanel.show(this.extensionUri, selection, openInNewTab);
    this.post({ type: "graphforge/resultSelection", ...this.context(state), linked: true,
      message: `Opened ${kind} ${id} in Entity Inspect${openInNewTab ? " (new tab)" : ""}.` });
  }

  private async openPersistedDocument(kind: "json" | "markdown"): Promise<void> {
    const file = kind === "json" ? this.state?.persisted?.jsonPath : this.state?.persisted?.markdownPath;
    if (!file) return;
    const uri = vscode.Uri.file(file);
    if (kind === "markdown") { await vscode.commands.executeCommand("markdown.showPreviewToSide", uri); return; }
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: true });
  }

  private postState(direction?: "next" | "previous" | "selection" | "reset", focusRow?: number): void {
    const state = this.state;
    if (!state || !this.view || !this.isCurrent(state)) return;
    this.view.description = `${state.source.rowCount} row(s)`;
    if (state.loading || !state.page) {
      this.post({ type: "graphforge/resultsLoading", ...this.context(state), title: state.title,
        rowCount: state.source.rowCount, persisted: Boolean(state.persisted), reset: !state.page });
    } else {
      this.post({ type: "graphforge/results", ...this.context(state), title: state.title, result: state.page,
        persisted: state.persisted, entityLinks: state.entityLinks, inspectNotice: state.inspectNotice, direction,
        selectedRows: resultPageSelection(state.page, state.selectedRows), selectedCount: state.selectedRows.size, focusRow });
    }
    if (state.error) this.post({ type: "graphforge/resultsError", ...this.context(state), message: state.error });
  }

  private post(message: HostToWebview): void {
    if (this.disposed || !this.view) return;
    if (message.type === "graphforge/results" && Buffer.byteLength(JSON.stringify(message)) > 8 * 1024 * 1024) {
      void this.view.webview.postMessage({ type: "graphforge/resultsError", resultId: message.resultId, revision: message.revision, pageVersion: message.pageVersion,
        message: "RESULT_MESSAGE_TOO_LARGE: Open the saved JSON or Markdown document to inspect this result." });
      return;
    }
    void this.view.webview.postMessage(message);
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
      <div class="actions" aria-label="Result pages">
        <button id="previous-rows" type="button" hidden>Previous rows</button>
        <button id="load-more" type="button" hidden>Next rows</button>
      </div>
    </footer>
  </main>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
