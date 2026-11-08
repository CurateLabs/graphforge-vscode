import type { ResultPage } from "../../../src/session/resultRows";
import type {
  HostToWebview,
  ResultEntityLink,
  ResultMessageContext,
  WebviewToHost,
} from "../../../src/webview/protocol";
import "./results.css";

const vscode = acquireVsCodeApi();
const title = document.getElementById("title");
const summary = document.getElementById("summary");
const linkStatus = document.getElementById("link-status");
const documentActions = document.getElementById("document-actions");
const empty = document.getElementById("empty");
const table = document.getElementById("results-table") as HTMLTableElement | null;
const tableHead = document.getElementById("table-head");
const tableBody = document.getElementById("table-body");
const footer = document.getElementById("footer");
const renderCount = document.getElementById("render-count");
const loadMore = document.getElementById("load-more") as HTMLButtonElement | null;
const previousPage = document.getElementById("previous-rows") as HTMLButtonElement | null;

let result: ResultPage | undefined;
let context: ResultMessageContext | undefined;
let loading = false;
let previousOffsets: number[] = [];
let columns: string[] = [];
let hasEntityLinks = false;
let selectedRows = new Set<number>();
let entityLinks: Record<string, ResultEntityLink[]> = {};

function post(message: WebviewToHost): void {
  vscode.postMessage(message);
}

function deriveColumns(current: ResultPage): string[] {
  if (current.columns.length > 0) return current.columns;
  const names = new Set<string>();
  for (const row of current.rows) {
    for (const key of Object.keys(row)) names.add(key);
  }
  return [...names];
}

function compactSummary(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).length}}`;
  return String(value);
}

function appendValue(cell: HTMLTableCellElement, value: unknown): void {
  if (value === null || value === undefined) {
    const missing = document.createElement("span");
    missing.className = "missing";
    missing.textContent = value === null ? "null" : "—";
    cell.append(missing);
    return;
  }
  if (typeof value !== "object") {
    const text = document.createElement("span");
    text.className = `value value-${typeof value}`;
    text.textContent = String(value);
    cell.append(text);
    return;
  }

  const details = document.createElement("details");
  details.className = "structured";
  const label = document.createElement("summary");
  label.textContent = compactSummary(value);
  const body = document.createElement("pre");
  body.textContent = JSON.stringify(value, null, 2);
  details.append(label, body);
  cell.append(details);
}

function select(rowIndex: number, column?: string): void {
  if (loading || !context) return;
  selectedRows = new Set([rowIndex]);
  updateSelectionClasses();
  post({ type: "graphforge/selectResult", ...context, rowIndex, column });
}

function renderHeader(): void {
  if (!tableHead) return;
  const row = document.createElement("tr");
  const index = document.createElement("th");
  index.className = "row-number";
  index.scope = "col";
  index.textContent = "#";
  row.append(index);
  for (const column of columns) {
    const header = document.createElement("th");
    header.scope = "col";
    header.textContent = column;
    row.append(header);
  }
  if (hasEntityLinks) {
    const inspect = document.createElement("th");
    inspect.className = "inspect-actions";
    inspect.scope = "col";
    inspect.textContent = "Inspect";
    row.append(inspect);
  }
  tableHead.replaceChildren(row);
}

function renderBody(): void {
  if (!result || !tableBody) return;
  const fragment = document.createDocumentFragment();
  const visible = result.rows;
  for (const [offset, rowValue] of visible.entries()) {
    const rowIndex = result.offset + offset;
    const row = document.createElement("tr");
    row.dataset.rowIndex = String(rowIndex);
    row.tabIndex = offset === 0 ? 0 : -1;
    row.setAttribute("aria-rowindex", String(rowIndex + 2));
    row.setAttribute("aria-selected", String(selectedRows.has(rowIndex)));
    row.setAttribute("aria-label", `Result row ${rowIndex + 1}`);
    if (selectedRows.has(rowIndex)) row.classList.add("selected");

    const index = document.createElement("th");
    index.className = "row-number";
    index.scope = "row";
    index.textContent = String(rowIndex + 1);
    row.append(index);
    for (const column of columns) {
      const cell = document.createElement("td");
      cell.dataset.column = column;
      appendValue(cell, rowValue[column]);
      row.append(cell);
    }
    if (hasEntityLinks) {
      const actions = document.createElement("td");
      actions.className = "inspect-actions";
      const buttons = document.createElement("div");
      buttons.className = "inspect-buttons";
      buttons.setAttribute("role", "group");
      buttons.setAttribute("aria-label", `Inspect entities in row ${rowIndex + 1}`);
      for (const link of entityLinks[String(rowIndex)] ?? []) {
        const button = document.createElement("button");
        button.className = `inspect-link inspect-${link.kind}`;
        button.type = "button";
        button.textContent = link.label;
        button.title = `Open ${link.kind} in Entity Inspect. Shift-click to open a new tab.`;
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          if (loading || !context) return;
          selectedRows = new Set([rowIndex]);
          updateSelectionClasses();
          post({
            type: "graphforge/openResultEntity", ...context,
            rowIndex,
            kind: link.kind,
            id: link.id,
            shiftKey: event.shiftKey,
          });
        });
        buttons.append(button);
      }
      actions.append(buttons);
      row.append(actions);
    }
    row.addEventListener("click", (event) => {
      const cell = (event.target as Element).closest<HTMLTableCellElement>(
        "td[data-column]",
      );
      select(rowIndex, cell?.dataset.column);
    });
    row.addEventListener("keydown", (event) => {
      if (event.target !== row) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select(rowIndex);
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const rows = [...tableBody.querySelectorAll<HTMLTableRowElement>("tr")];
        const index = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1
          : Math.max(0, Math.min(rows.length - 1, offset + (event.key === "ArrowDown" ? 1 : -1)));
        rows.forEach((item, i) => { item.tabIndex = i === index ? 0 : -1; });
        rows[index]?.focus();
      }
    });
    fragment.append(row);
  }
  tableBody.replaceChildren(fragment);
  updateFooter();
}

function updateFooter(): void {
  if (!result || !footer || !renderCount || !loadMore) return;
  const shown = result.offset + result.rows.length;
  footer.hidden = result.rows.length === 0;
  renderCount.textContent =
    `Rows ${(result.offset + 1).toLocaleString()}–${shown.toLocaleString()} of ${result.rowCount.toLocaleString()}`;
  const canGoBack = previousOffsets.length > 0 || result.offset > 0;
  loadMore.hidden = result.nextOffset === undefined && !canGoBack;
  loadMore.disabled = loading || result.nextOffset === undefined;
  if (previousPage) {
    previousPage.hidden = loadMore.hidden;
    previousPage.disabled = loading || !canGoBack;
    previousPage.textContent = previousOffsets.length === 0 && result.offset > 0 ? "First rows" : "Previous rows";
  }
}

function setLoading(value: boolean): void {
  loading = value;
  table?.setAttribute("aria-busy", String(value));
  tableBody?.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = value; });
  documentActions?.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = value; });
  updateFooter();
}

function updateSelectionClasses(): void {
  tableBody?.querySelectorAll<HTMLTableRowElement>("tr[data-row-index]").forEach((row) => {
    row.classList.toggle(
      "selected",
      selectedRows.has(Number(row.dataset.rowIndex)),
    );
    row.setAttribute("aria-selected", String(selectedRows.has(Number(row.dataset.rowIndex))));
  });
}

function renderResults(
  current: ResultPage,
  currentTitle: string,
  persisted: boolean,
  links: Record<string, ResultEntityLink[]>,
  inspectNotice?: string,
): void {
  result = current;
  columns = deriveColumns(current);
  selectedRows.clear();
  entityLinks = links;
  hasEntityLinks = Object.keys(links).length > 0;
  if (title) title.textContent = currentTitle;
  if (summary) {
    const columnLabel = `${columns.length} column${columns.length === 1 ? "" : "s"}`;
    summary.textContent = `${current.rowCount.toLocaleString()} row${current.rowCount === 1 ? "" : "s"} · ${columnLabel}${inspectNotice ? ` · ${inspectNotice}` : ""}`;
  }
  if (documentActions) documentActions.hidden = !persisted;
  if (linkStatus) {
    linkStatus.textContent =
      "Select a row to highlight the Result Graph, or use Inspect to open an entity.";
    linkStatus.classList.remove("linked", "unlinked");
  }
  const hasRows = current.rows.length > 0;
  if (empty) {
    empty.hidden = hasRows;
    empty.textContent = hasRows
      ? ""
      : "The query completed successfully but returned no rows.";
  }
  if (table) {
    table.hidden = !hasRows;
    table.setAttribute("aria-rowcount", String(current.rowCount + 1));
  }
  renderHeader();
  renderBody();
}

function highlightRows(rowIndices: number[], selectedCount: number, focusRow?: number): void {
  if (!result) return;
  selectedRows = new Set(rowIndices.filter(index => Number.isSafeInteger(index) &&
    index >= result!.offset && index < result!.offset + result!.rows.length));
  updateSelectionClasses();
  if (focusRow !== undefined && selectedRows.has(focusRow)) {
    tableBody?.querySelector<HTMLTableRowElement>(`tr[data-row-index="${focusRow}"]`)
      ?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  if (linkStatus) {
    linkStatus.textContent = selectedCount === 0 ? "No result rows selected."
      : `Visualization selection appears in ${selectedCount.toLocaleString()} row(s); ${selectedRows.size.toLocaleString()} on this page.`;
    linkStatus.classList.toggle("linked", selectedCount > 0);
    linkStatus.classList.remove("unlinked");
  }
}

function requestPage(offset: number, direction: "next" | "previous"): void {
  if (loading || !context) return;
  post({ type: "graphforge/requestResultPage", ...context, offset, direction });
  setLoading(true);
}

loadMore?.addEventListener("click", () => {
  if (result?.nextOffset !== undefined) requestPage(result.nextOffset, "next");
});
previousPage?.addEventListener("click", () => {
  // Reloaded webviews have no visited boundaries. Returning to zero preserves
  // byte-shortened page boundaries when the user resumes forward navigation.
  const offset = previousOffsets.at(-1) ?? (result && result.offset > 0 ? 0 : undefined);
  if (offset !== undefined) requestPage(offset, "previous");
});
document.getElementById("open-json")?.addEventListener("click", () => {
  if (!loading && context) post({ type: "graphforge/openResultDocument", ...context, kind: "json" });
});
document.getElementById("open-markdown")?.addEventListener("click", () => {
  if (!loading && context) post({ type: "graphforge/openResultDocument", ...context, kind: "markdown" });
});

function sameContext(incoming: ResultMessageContext): boolean {
  return context !== undefined && incoming.resultId === context.resultId &&
    incoming.revision === context.revision && incoming.pageVersion === context.pageVersion;
}

/** Only a page/loading response can advance identity. Older async responses never replace the current source. */
function acceptContext(incoming: ResultMessageContext): boolean {
  if (!Number.isSafeInteger(incoming.revision) || !Number.isSafeInteger(incoming.pageVersion) ||
      typeof incoming.resultId !== "string") return false;
  if (context && (incoming.revision < context.revision ||
      (incoming.revision === context.revision && (incoming.resultId !== context.resultId || incoming.pageVersion < context.pageVersion)))) return false;
  if (!context || incoming.revision > context.revision) {
    result = undefined;
    previousOffsets = [];
    selectedRows.clear();
    entityLinks = {};
    tableBody?.replaceChildren();
    tableHead?.replaceChildren();
    if (table) table.hidden = true;
    if (footer) footer.hidden = true;
  }
  context = { resultId: incoming.resultId, revision: incoming.revision, pageVersion: incoming.pageVersion };
  return true;
}

window.addEventListener("message", (event: MessageEvent<HostToWebview>) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;
  if (message.type === "graphforge/resultsCleared") {
    if (!acceptContext(message)) return;
    setLoading(false);
    if (documentActions) documentActions.hidden = true;
    if (title) title.textContent = "Query results";
    if (summary) summary.textContent = message.message;
    if (empty) { empty.hidden = false; empty.textContent = message.message; }
    if (linkStatus) {
      linkStatus.textContent = message.message;
      linkStatus.classList.remove("linked", "unlinked");
    }
  } else if (message.type === "graphforge/resultsLoading") {
    if (!acceptContext(message)) return;
    setLoading(true);
    if (title) title.textContent = message.title;
    if (summary) summary.textContent = `${message.rowCount.toLocaleString()} row(s) · Loading page…`;
    if (documentActions) documentActions.hidden = !message.persisted;
    if (!result && empty) { empty.hidden = false; empty.textContent = "Loading result rows…"; }
    if (linkStatus) {
      linkStatus.textContent = "Loading result rows…";
      linkStatus.classList.remove("linked", "unlinked");
    }
  } else if (message.type === "graphforge/results") {
    if (message.result.resultId !== message.resultId || !acceptContext(message)) return;
    const priorOffset = result?.offset;
    if (priorOffset !== undefined && priorOffset !== message.result.offset) {
      if (message.direction === "previous") previousOffsets.pop();
      else if (message.direction === "next" || message.direction === "selection") previousOffsets.push(priorOffset);
    }
    renderResults(message.result, message.title, Boolean(message.persisted), message.entityLinks ?? {}, message.inspectNotice);
    setLoading(false);
    highlightRows(message.selectedRows ?? [], message.selectedCount ?? 0, message.focusRow);
    if (message.direction === "next" || message.direction === "previous") tableBody?.querySelector<HTMLTableRowElement>("tr")?.focus();
  } else if (message.type === "graphforge/resultsError") {
    if (!sameContext(message)) return;
    setLoading(false);
    if (summary) summary.textContent = result ? `${result.rowCount.toLocaleString()} row(s) · Page could not be loaded` : "Results could not be loaded";
    if (!result && empty) { empty.hidden = false; empty.textContent = message.message; }
    if (linkStatus) {
      linkStatus.textContent = message.message;
      linkStatus.classList.add("unlinked");
      linkStatus.classList.remove("linked");
    }
  } else if (message.type === "graphforge/resultSelection") {
    if (!sameContext(message) || loading) return;
    if (linkStatus) {
      linkStatus.textContent = message.message;
      linkStatus.classList.toggle("linked", message.linked);
      linkStatus.classList.toggle("unlinked", !message.linked);
    }
  } else if (message.type === "graphforge/highlightResultRows") {
    if (sameContext(message) && !loading) highlightRows(message.rowIndices, message.selectedCount, message.focusRow);
  }
});

post({ type: "graphforge/ready" });
