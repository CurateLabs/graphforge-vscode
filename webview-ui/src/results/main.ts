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
const previousPage = document.getElementById("previous-rows") as HTMLButtonElement | null;

let result: QueryResult | undefined;
let columns: string[] = [];
let pageStart = 0;
let hasEntityLinks = false;
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
  const visible = result.rows.slice(pageStart, pageStart + PAGE_SIZE);
  for (const [offset, rowValue] of visible.entries()) {
    const rowIndex = pageStart + offset;
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
  const shown = Math.min(pageStart + PAGE_SIZE, result.rows.length);
  footer.hidden = result.rows.length === 0;
  renderCount.textContent =
    `Rows ${(pageStart + 1).toLocaleString()}–${shown.toLocaleString()} of ${result.rows.length.toLocaleString()}`;
  loadMore.hidden = result.rows.length <= PAGE_SIZE;
  loadMore.disabled = shown >= result.rows.length;
  if (previousPage) {
    previousPage.hidden = result.rows.length <= PAGE_SIZE;
    previousPage.disabled = pageStart === 0;
  }
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
  current: QueryResult,
  currentTitle: string,
  persisted: boolean,
  links: Record<string, ResultEntityLink[]>,
): void {
  result = current;
  columns = deriveColumns(current);
  pageStart = 0;
  selectedRows.clear();
  entityLinks = links;
  hasEntityLinks = Object.keys(links).length > 0;
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
  if (table) {
    table.hidden = !hasRows;
    table.setAttribute("aria-rowcount", String(current.rows.length + 1));
  }
  renderHeader();
  renderBody();
}

function highlightRows(rowIndices: number[]): void {
  if (!result || rowIndices.length === 0) return;
  rowIndices = rowIndices.filter(index => Number.isSafeInteger(index) && index >= 0 && index < result!.rows.length);
  if (!rowIndices.length) return;
  selectedRows = new Set(rowIndices);
  const first = rowIndices.reduce((minimum, index) => Math.min(minimum, index), Infinity);
  if (first < pageStart || first >= pageStart + PAGE_SIZE) {
    pageStart = Math.floor(first / PAGE_SIZE) * PAGE_SIZE;
    renderBody();
  } else {
    updateSelectionClasses();
  }
  tableBody
    ?.querySelector<HTMLTableRowElement>(`tr[data-row-index="${first}"]`)
    ?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  if (linkStatus) {
    linkStatus.textContent = `Result Graph selection appears in ${rowIndices.length} row(s).`;
    linkStatus.classList.add("linked");
    linkStatus.classList.remove("unlinked");
  }
}

loadMore?.addEventListener("click", () => {
  if (!result) return;
  pageStart = Math.min(Math.floor((result.rows.length - 1) / PAGE_SIZE) * PAGE_SIZE, pageStart + PAGE_SIZE);
  renderBody();
  tableBody?.querySelector<HTMLTableRowElement>("tr")?.focus();
});
previousPage?.addEventListener("click", () => {
  pageStart = Math.max(0, pageStart - PAGE_SIZE);
  renderBody();
  tableBody?.querySelector<HTMLTableRowElement>("tr")?.focus();
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
