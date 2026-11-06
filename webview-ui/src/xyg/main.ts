import "./xyg.css";
const vscode = acquireVsCodeApi();
const config = JSON.parse(document.getElementById("xyg-config")!.textContent!);
const chart = document.getElementById("chart")!;
const status = document.getElementById("status")!;
const notice = document.getElementById("notice")!;
const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
let context: { instanceId: string; renderGeneration: number } | undefined;
let frame = 0;
let view: any;
let disposed = false;
let worker: any;
let workerReady: Promise<any> | undefined;
const assetAbort = new AbortController();
const client = import(/* @vite-ignore */ config.clientUri);
const post = (type: string, extra: Record<string, unknown> = {}) =>
  vscode.postMessage({ type, ...context, ...extra });
const tickWorker = () => {
  if (workerReady) return workerReady;
  const pending = (async () => {
  const xy = await client;
  const [source, wasm] = await Promise.all([config.workerUri, config.wasmUri].map(async uri => {
    const response = await fetch(uri, { signal: assetAbort.signal });
    if (!response.ok) throw Object.assign(new Error("XYG WASM asset is unavailable. Reload the installed extension."), { code: "XYG_WASM_ASSET_MISSING" });
    return response.arrayBuffer();
  }));
  if (disposed) throw Object.assign(new Error("XYG view disposed"), { code: "XYG_DISPOSED" });
  // VS Code's resource origin cannot create a module Worker directly. This
  // bundled, self-contained worker is loaded locally and started from a Blob.
  const url = URL.createObjectURL(new Blob([source], { type: "application/javascript" }));
  try {
    worker = new xy.XygWasmWorker({ workerUrl: url, wasm });
    post("diagnostic", { phase: "worker-started" });
    await worker.ready;
    if (disposed) { await worker.dispose(); throw Object.assign(new Error("XYG view disposed"), { code: "XYG_DISPOSED" }); }
    post("diagnostic", { phase: "worker-ready" });
    return worker;
  } catch (error) {
    await worker?.dispose();
    throw error;
  } finally { URL.revokeObjectURL(url); }
  })();
  workerReady = pending;
  void pending.catch(() => { if (workerReady === pending) workerReady = undefined; });
  return pending;
};
const motionChanged = () => post("motionPreference", { reducedMotion: motionPreference.matches });
motionPreference.addEventListener("change", motionChanged);
const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
let viewportTimer: ReturnType<typeof setTimeout> | undefined;
let hostWidth = 0;
let hostHeight = 0;
let reportedViewport = "";
const viewport = () => ({
  width: Math.min(4096, chart.clientWidth),
  height: Math.min(4096, chart.clientHeight),
});
const queueViewport = () => {
  clearTimeout(viewportTimer);
  viewportTimer = setTimeout(() => {
    if (disposed || !context) return;
    const size = viewport();
    if (size.width <= 0 || size.height <= 0 ||
        (size.width === hostWidth && size.height === hostHeight)) return;
    const key = `${context.renderGeneration}:${size.width}:${size.height}`;
    if (key === reportedViewport) return;
    reportedViewport = key;
    post("viewport", size);
  }, 100);
};
const resizeObserver = new ResizeObserver(queueViewport);
resizeObserver.observe(chart);
window.addEventListener("message", async (event: MessageEvent) => {
  const message = event.data;
  if (!message || typeof message.type !== "string") return;
  if (
    context &&
    (message.instanceId !== context.instanceId ||
      message.renderGeneration < context.renderGeneration)
  )
    return;
  if (context && message.renderGeneration > context.renderGeneration) {
    view?.destroy();
  }
  context = {
    instanceId: message.instanceId,
    renderGeneration: message.renderGeneration,
  };
  if (message.type === "status") {
    hostWidth = message.width;
    hostHeight = message.height;
    queueViewport();
    status.textContent = message.message;
    status.setAttribute("role", "status");
    chart.setAttribute("aria-busy", String(!message.ready));
    (document.getElementById("fit") as HTMLButtonElement).disabled = !message.ready;
    (document.getElementById("relayout") as HTMLButtonElement).disabled = !message.ready;
    const exportButton = document.getElementById("export") as HTMLButtonElement;
    exportButton.disabled = !message.ready || !message.exportAvailable;
    exportButton.title = message.exportAvailable ? "Save this view as PNG and SVG"
      : "Time-axis image export is not available in this XYG build.";
    const htmlExportButton = document.getElementById("export-html") as HTMLButtonElement;
    htmlExportButton.disabled = !message.ready || !message.htmlExportAvailable;
    htmlExportButton.title = message.htmlExportAvailable ? "Save this view as a self-contained HTML file"
      : "HTML export is not available for this view.";
    if (message.title)
      document.getElementById("title")!.textContent = message.title;
    return;
  }
  if (message.type === "notice") {
    notice.textContent = message.message;
    return;
  }
  if (message.type === "error") {
    status.textContent = `${message.code}: ${message.message}`;
    status.setAttribute("role", "alert");
    chart.setAttribute("aria-busy", "false");
    (document.getElementById("export") as HTMLButtonElement).disabled = true;
    (document.getElementById("export-html") as HTMLButtonElement).disabled = true;
    (document.getElementById("relayout") as HTMLButtonElement).disabled = false;
    return;
  }
  if (
    message.type !== "frame" ||
    !Number.isInteger(message.frame) ||
    message.frame <= frame
  )
    return;
  const rendering = message.frame;
  const generation = message.renderGeneration;
  try {
    const xy = await client;
    if (
      disposed ||
      rendering < frame ||
      context?.renderGeneration !== generation
    )
      return;
    frame = rendering;
    post("diagnostic", { phase: "client-loaded" });
    view?.destroy();
    chart.replaceChildren();
    const buffer =
      message.buffer instanceof ArrayBuffer
        ? message.buffer
        : new Uint8Array(message.buffer.data ?? message.buffer).buffer;
    if (message.painter)
      view = xy.hydrateWasmPainter(chart, { painter: buffer });
    else {
      const currentView = xy.renderStandalone(chart, message.spec, buffer);
      view = currentView;
      post("diagnostic", { phase: "view-created" });
      const ticks = await tickWorker();
      if (disposed || frame !== rendering || context?.renderGeneration !== generation) { currentView.destroy(); return; }
      await xy.attachWasmTicks(currentView, { worker: ticks, workerOwnership: "borrow" });
      post("diagnostic", { phase: "ticks-ready" });
    }
    await nextFrame();
    await nextFrame();
    if (
      frame !== rendering ||
      disposed ||
      context?.renderGeneration !== generation
    )
      return;
    status.textContent = `XYG · ${message.phase === "complete" ? "Rendered" : "Laying out…"}`;
    post("diagnostic", { phase: "painted" });
    post("painted", { frame: rendering });
  } catch (error) {
    if (
      disposed ||
      frame !== rendering ||
      context?.renderGeneration !== generation
    )
      return;
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "XYG_PAINT_FAILED";
    status.textContent = `${code}: ${error instanceof Error ? error.message : "XYG paint failed."}`;
    post("failed", { code });
  }
});
chart.addEventListener("xy:click", (event) => {
  const hit = (event as CustomEvent).detail;
  post("pick", { trace: hit?.trace, index: hit?.index, frame });
});
document
  .getElementById("fit")!
  .addEventListener("click", () =>
    view?.resetView({
      animate: !motionPreference.matches,
    }),
  );
document
  .getElementById("relayout")!
  .addEventListener("click", () => post("relayout"));
document
  .getElementById("export")!
  .addEventListener("click", () => post("export"));
document
  .getElementById("export-html")!
  .addEventListener("click", () => post("export", { format: "html" }));
window.addEventListener("pagehide", () => {
  disposed = true;
  clearTimeout(viewportTimer);
  resizeObserver.disconnect();
  motionPreference.removeEventListener("change", motionChanged);
  view?.destroy();
  assetAbort.abort();
  void worker?.dispose();
});
post("ready", { reducedMotion: motionPreference.matches, ...viewport() });
