/**
 * XYG visualization webview (#80). XYG paints; this script only moves bytes,
 * relays picks by UUID/result row, and shows coded status. Native host: the
 * extension host composed the result, so this calls `renderStandalone`.
 * Direct-browser WASM host: this composes the same request bytes in a
 * Blob-URL module Worker (webview resources are cross-origin).
 */
import {
  createXygWasmWorker,
  graphforgeTableElement,
  composeWasmGraphForge,
  renderStandalone,
  renderWasmGraphForge,
  type XygBrowserComposition,
  type XygView,
  type XygWasmWorker,
} from "@curatelabs/xyg";
import type {
  XygHostToWebview,
  XygMessageContext,
  XygPanelStatus,
  XygWasmComposeInput,
  XygWebviewToHost,
} from "../../../src/webview/xygProtocol";
import "./style.css";

const vscode = acquireVsCodeApi();
const app = document.getElementById("app") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLElement;
const errorEl = document.getElementById("error") as HTMLElement;
const viewEl = document.getElementById("view") as HTMLElement;
const tableEl = document.getElementById("table") as HTMLElement;

let context: XygMessageContext | undefined;
let view: XygView | undefined;
let worker: Promise<XygWasmWorker> | undefined;
let wasm: { composition: XygBrowserComposition; input: XygWasmComposeInput; resultId: string } | undefined;

function post(message: XygWebviewToHost): void {
  vscode.postMessage(message);
}

function theme(): "light" | "dark" {
  const classes = document.body.classList;
  return classes.contains("vscode-light") || classes.contains("vscode-high-contrast-light")
    ? "light"
    : "dark";
}

function size(): { width: number; height: number } {
  const rect = viewEl.getBoundingClientRect();
  return {
    width: Math.max(320, Math.floor(rect.width)),
    height: Math.max(240, Math.floor(rect.height)),
  };
}

function describe(status: XygPanelStatus): string {
  const host = status.host === "wasm" ? "XYG browser (WASM)" : "XYG native";
  if (status.phase === "prepare") return `${status.title}: composing with ${host}…`;
  const counts = [
    status.nodes ? `${status.nodes} nodes` : "",
    status.edges ? `${status.edges} edges` : "",
    status.rows ? `${status.rows} rows` : "",
  ].filter(Boolean);
  const decided = status.decisions?.length ? ` · ${status.decisions.join(", ")}` : "";
  const phase = status.phase === "paint" ? "painting" : status.phase;
  return `${status.title} · ${status.intent} · ${host}${counts.length ? ` · ${counts.join(", ")}` : ""}${decided} (${phase})`;
}

function clear(): void {
  view?.destroy();
  view = undefined;
  viewEl.replaceChildren();
  tableEl.replaceChildren();
  tableEl.hidden = true;
  viewEl.hidden = false;
  errorEl.hidden = true;
}

function showError(code: string, message: string, nextAction?: string): void {
  clear();
  viewEl.hidden = true;
  const title = document.createElement("strong");
  title.textContent = code;
  const detail = document.createElement("p");
  detail.textContent = message;
  errorEl.replaceChildren(title, detail);
  if (nextAction) {
    const next = document.createElement("p");
    next.textContent = nextAction;
    errorEl.append(next);
  }
  errorEl.hidden = false;
  statusEl.textContent = `Visualization failed (${code}).`;
}

function failed(err: unknown): void {
  const record = (err ?? {}) as { code?: unknown; message?: unknown; layer?: unknown; field?: unknown };
  // Uncoded failures come from the paint client itself (not XYG's coded
  // composition/WASM errors); report them as a paint failure.
  const code = typeof record.code === "string" ? record.code : "XYG_PAINT_FAILED";
  const message = typeof record.message === "string" ? record.message : "The XYG paint client failed.";
  showError(code, message);
  if (context) {
    post({
      ...context,
      type: "xyg.failed",
      code,
      message,
      layer: typeof record.layer === "number" ? record.layer : null,
      field: typeof record.field === "string" ? record.field : null,
    });
  }
}

/** WASM stages never hang the view: each reports its own coded timeout. */
const WASM_STAGE_TIMEOUT_MS = 20_000;

function within<T>(stage: string, work: Promise<T>): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(
      () => reject({ code: `XYG_WASM_${stage}_TIMEOUT`, message: `The XYG browser host did not finish ${stage.toLowerCase()} in time.` }),
      WASM_STAGE_TIMEOUT_MS,
    );
  });
  return Promise.race([work, timeout]).finally(() => window.clearTimeout(timer));
}

/** Local Worker + WASM assets only; the Worker comes from a Blob URL. */
function wasmWorker(): Promise<XygWasmWorker> {
  worker ??= (async () => {
    const source = await within("FETCH", fetch(app.dataset.worker!).then((r) => r.text()));
    const workerUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const bytes = new Uint8Array(await within<ArrayBuffer>("FETCH", fetch(app.dataset.wasm!).then((r) => r.arrayBuffer())));
    const created = createXygWasmWorker({ workerUrl, wasm: bytes, maxArenaBytes: 64 << 20 });
    // The Worker instantiates and version-checks the WASM asynchronously;
    // requests before `ready` fail with XYG_WASM_NOT_READY.
    await within("INIT", created.ready);
    return created;
  })();
  worker.catch(() => { worker = undefined; });
  return worker;
}

const NONE_ROW = 0xffffffffffffffffn;

/** Result rows → composed UUIDs from Rust's row planes (derived edges → endpoints). */
function rowUuids(composition: XygBrowserComposition, resultId: string, rows: Set<number>): string[] {
  const uuids = new Set<string>();
  for (const layer of composition.layers) {
    if (layer.resultId !== resultId) continue;
    layer.nodeRows?.forEach((row, i) => {
      if (row !== NONE_ROW && rows.has(Number(row))) uuids.add(composition.nodeUuid[i]);
    });
    layer.edgeRows?.forEach((row, j) => {
      if (row === NONE_ROW || !rows.has(Number(row))) return;
      const uuid = composition.edgeUuid[j];
      if (uuid) {
        uuids.add(uuid);
      } else {
        const identity = composition.identify("edge", j);
        if (identity.source) uuids.add(identity.source);
        if (identity.target) uuids.add(identity.target);
      }
    });
  }
  return [...uuids];
}

async function renderWasm(input: XygWasmComposeInput, resultId: string, ctx: XygMessageContext): Promise<void> {
  const xygWorker = await wasmWorker();
  if (context !== ctx) return;
  const intent = input.layers[0]?.intent;
  if (intent === "table") {
    const table = await within("COMPOSE", composeWasmGraphForge(xygWorker, input).result);
    if (context !== ctx) return;
    clear();
    viewEl.hidden = true;
    tableEl.append(graphforgeTableElement(table));
    tableEl.hidden = false;
    wasm = { composition: table, input, resultId };
  } else {
    // Bar charts, parallel coordinates, and embedding scatters render on the
    // native host; renderWasmGraphForge rejects them with a coded error.
    const { width, height } = size();
    clear();
    const rendered = await within(
      "RENDER",
      renderWasmGraphForge({ el: viewEl, worker: xygWorker, width, height, theme: theme(), input }),
    );
    if (context !== ctx) {
      rendered.view.destroy();
      return;
    }
    view = rendered.view;
    wasm = { composition: rendered.composition, input, resultId };
    view.root.addEventListener("xy:graphforge-select", (event) => {
      const detail = (event as CustomEvent).detail;
      if (context && detail) post({ ...context, type: "xyg.pickIdentity", identity: detail });
    });
  }
}

async function onMessage(message: XygHostToWebview): Promise<void> {
  if (message.type === "xyg.status") {
    statusEl.textContent = describe(message.status);
    return;
  }
  const ctx: XygMessageContext = { instanceId: message.instanceId, renderGeneration: message.renderGeneration };
  if (message.type === "xyg.error") {
    context = ctx;
    showError(message.code, message.message, message.nextAction);
    return;
  }
  if (message.type === "xyg.selectRows") {
    if (!wasm || !context || message.renderGeneration !== context.renderGeneration) return;
    const select = rowUuids(wasm.composition, wasm.resultId, new Set(message.rows));
    if (select.length === 0) return;
    await renderWasm({ ...wasm.input, select }, wasm.resultId, context).catch(failed);
    return;
  }
  context = ctx;
  const started = performance.now();
  statusEl.textContent = describe(message.status);
  try {
    if (message.mode === "native") {
      clear();
      const buffer = new Uint8Array(message.buffer).slice().buffer;
      view = renderStandalone(viewEl, message.spec, buffer);
      view.root.addEventListener("xy:click", (event) => {
        const detail = (event as CustomEvent<{ trace?: number; index?: number }>).detail;
        if (context && Number.isInteger(detail?.trace) && Number.isInteger(detail?.index)) {
          post({ ...context, type: "xyg.pick", trace: detail.trace!, index: detail.index! });
        }
      });
    } else if (message.mode === "table") {
      clear();
      viewEl.hidden = true;
      // XYG escapes every cell (text only, never markup).
      tableEl.innerHTML = message.html;
      tableEl.hidden = false;
    } else {
      await renderWasm(message.input, message.resultId, ctx);
    }
    if (context === ctx) {
      statusEl.textContent = describe({ ...message.status, phase: "ready" });
      post({ ...ctx, type: "xyg.rendered", durationMs: Math.round(performance.now() - started) });
    }
  } catch (err) {
    if (context === ctx) failed(err);
  }
}

window.addEventListener("message", (event) => {
  void onMessage(event.data as XygHostToWebview);
});

let resizeTimer: number | undefined;
new ResizeObserver(() => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => post({ type: "xyg.resize", ...size() }), 150);
}).observe(viewEl);

post({ type: "xyg.ready", ...size(), theme: theme() });
