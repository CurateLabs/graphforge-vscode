import type { QueryResult } from "../../../src/session/types";
import type {
  HostToWebview,
  ResultEntityLink,
  WebviewToHost,
} from "../../../src/webview/protocol";
import "./results.css";

const PAGE_SIZE = 500;
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

let result: QueryResult | undefined;
let columns: string[] = [];
let renderedRows = PAGE_SIZE;
let selectedRows = new Set<number>();
let entityLinks: Record<string, ResultEntityLink[]> = {};

function post(message: WebviewToHost): void {
  vscode.postMessage(message);
}

function deriveColumns(current: QueryResult): string[] {
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
  selectedRows = new Set([rowIndex]);
  updateSelectionClasses();
  post({ type: "graphforge/selectResult", rowIndex, column });
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
  if (Object.keys(entityLinks).length > 0) {
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
  const visible = result.rows.slice(0, renderedRows);
  for (const [rowIndex, rowValue] of visible.entries()) {
    const row = document.createElement("tr");
    row.dataset.rowIndex = String(rowIndex);
    row.tabIndex = 0;
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
    if (Object.keys(entityLinks).length > 0) {
      const actions = document.createElement("td");
      actions.className = "inspect-actions";
      for (const link of entityLinks[String(rowIndex)] ?? []) {
        const button = document.createElement("button");
        button.className = `inspect-link inspect-${link.kind}`;
        button.type = "button";
        button.textContent = link.label;
        button.title = `Open ${link.kind} in Entity Inspect. Shift-click to open a new tab.`;
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          selectedRows = new Set([rowIndex]);
          updateSelectionClasses();
          post({
            type: "graphforge/openResultEntity",
            rowIndex,
            kind: link.kind,
            id: link.id,
            shiftKey: event.shiftKey,
          });
        });
        actions.append(button);
      }
      row.append(actions);
    }
    row.addEventListener("click", (event) => {
      const cell = (event.target as Element).closest<HTMLTableCellElement>(
        "td[data-column]",
      );
      select(rowIndex, cell?.dataset.column);
    });
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select(rowIndex);
      }
    });
    fragment.append(row);
  }
  tableBody.replaceChildren(fragment);
  updateFooter();
}

function updateFooter(): void {
  if (!result || !footer || !renderCount || !loadMore) return;
  const shown = Math.min(renderedRows, result.rows.length);
  footer.hidden = result.rows.length === 0;
  renderCount.textContent =
    shown < result.rows.length
      ? `Showing ${shown.toLocaleString()} of ${result.rows.length.toLocaleString()} rows`
      : `${result.rows.length.toLocaleString()} rows`;
  loadMore.hidden = shown >= result.rows.length;
}

function updateSelectionClasses(): void {
  tableBody?.querySelectorAll<HTMLTableRowElement>("tr[data-row-index]").forEach((row) => {
    row.classList.toggle(
      "selected",
      selectedRows.has(Number(row.dataset.rowIndex)),
    );
  });
}

function renderResults(
  current: QueryResult,
  currentTitle: string,
  persisted: boolean,
  links: Record<string, ResultEntityLink[]>,
): void {
  result = current;
  columns = deriveColumns(current);
  renderedRows = PAGE_SIZE;
  selectedRows.clear();
  entityLinks = links;
  if (title) title.textContent = currentTitle;
  if (summary) {
    const columnLabel = `${columns.length} column${columns.length === 1 ? "" : "s"}`;
    summary.textContent = `${current.rowCount.toLocaleString()} row${current.rowCount === 1 ? "" : "s"} · ${columnLabel}`;
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
  if (table) table.hidden = !hasRows;
  renderHeader();
  renderBody();
}

function highlightRows(rowIndices: number[]): void {
  if (!result || rowIndices.length === 0) return;
  selectedRows = new Set(rowIndices);
  const first = Math.min(...rowIndices);
  if (first >= renderedRows) {
    renderedRows = Math.min(result.rows.length, first + 1);
    renderBody();
  } else {
    updateSelectionClasses();
  }
  tableBody
    ?.querySelector<HTMLTableRowElement>(`tr[data-row-index="${first}"]`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
  if (linkStatus) {
    linkStatus.textContent = `Result Graph selection appears in ${rowIndices.length} row(s).`;
    linkStatus.classList.add("linked");
    linkStatus.classList.remove("unlinked");
  }
}

loadMore?.addEventListener("click", () => {
  if (!result) return;
  renderedRows = Math.min(result.rows.length, renderedRows + PAGE_SIZE);
  renderBody();
});
document.getElementById("open-json")?.addEventListener("click", () => {
  post({ type: "graphforge/openResultDocument", kind: "json" });
});
document.getElementById("open-markdown")?.addEventListener("click", () => {
  post({ type: "graphforge/openResultDocument", kind: "markdown" });
});

window.addEventListener("message", (event: MessageEvent<HostToWebview>) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;
  if (message.type === "graphforge/results") {
    renderResults(
      message.result,
      message.title,
      Boolean(message.persisted),
      message.entityLinks ?? {},
    );
  } else if (message.type === "graphforge/resultSelection") {
    if (linkStatus) {
      linkStatus.textContent = message.message;
      linkStatus.classList.toggle("linked", message.linked);
      linkStatus.classList.toggle("unlinked", !message.linked);
    }
  } else if (message.type === "graphforge/highlightResultRows") {
    highlightRows(message.rowIndices);
  }
});

post({ type: "graphforge/ready" });
