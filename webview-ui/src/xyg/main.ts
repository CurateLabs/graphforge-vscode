import "./xyg.css";
const vscode = acquireVsCodeApi();
const config = JSON.parse(document.getElementById("xyg-config")!.textContent!);
const chart = document.getElementById("chart")!;
const status = document.getElementById("status")!;
const notice = document.getElementById("notice")!;
let context: { instanceId: string; renderGeneration: number } | undefined;
let frame = 0;
let view: any;
let disposed = false;
const tickRequests = new Map<
  string,
  {
    resolve: (packet: ArrayBuffer) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const client = import(/* @vite-ignore */ config.clientUri);
const post = (type: string, extra: Record<string, unknown> = {}) =>
  vscode.postMessage({ type, ...context, ...extra });
const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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
    for (const request of tickRequests.values())
      request.reject(new Error("XYG_TICK_SUPERSEDED"));
    tickRequests.clear();
  }
  context = {
    instanceId: message.instanceId,
    renderGeneration: message.renderGeneration,
  };
  if (message.type === "tickResult") {
    const key = `${message.frame}:${message.requestId}`,
      request = tickRequests.get(key);
    if (request) {
      clearTimeout(request.timer);
      tickRequests.delete(key);
      if (message.error) request.reject(new Error(message.error));
      else request.resolve(message.packet);
    }
    return;
  }
  if (message.type === "status") {
    status.textContent = message.message;
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
      view = xy.renderStandalone(chart, message.spec, buffer);
      post("diagnostic", { phase: "view-created" });
      const host = xy.createHostTickEngine({
        resolve: (
          packet: ArrayBuffer,
          task: { requestId: number; signal: AbortSignal },
        ) =>
          new Promise<ArrayBuffer>((resolve, reject) => {
            const key = `${rendering}:${task.requestId}`;
            const cleanup = () => {
              clearTimeout(timer);
              tickRequests.delete(key);
              task.signal.removeEventListener("abort", cancel);
            };
            const fail = (error: Error) => {
              cleanup();
              reject(error);
            };
            const cancel = () => fail(new Error("XYG_TICK_CANCELLED"));
            if (task.signal.aborted) {
              reject(new Error("XYG_TICK_CANCELLED"));
              return;
            }
            task.signal.addEventListener("abort", cancel, { once: true });
            const timer = setTimeout(
              () => fail(new Error("XYG_TICK_TIMEOUT")),
              10000,
            );
            tickRequests.set(key, {
              resolve: (result) => {
                cleanup();
                resolve(result);
              },
              reject: fail,
              timer,
            });
            post("ticks", {
              packet,
              requestId: task.requestId,
              frame: rendering,
              renderGeneration: generation,
            });
          }),
      });
      await xy.attachRustTicks(view, { worker: host, workerOwnership: "own" });
      post("diagnostic", { phase: "ticks-ready" });
    }
    chart.style.backgroundColor = document.body.classList.contains(
      "vscode-light",
    )
      ? "white"
      : "#111827";
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
      animate: !matchMedia("(prefers-reduced-motion: reduce)").matches,
    }),
  );
document
  .getElementById("relayout")!
  .addEventListener("click", () => post("relayout"));
document
  .getElementById("export")!
  .addEventListener("click", () => post("export"));
window.addEventListener("pagehide", () => {
  disposed = true;
  view?.destroy();
  for (const request of tickRequests.values())
    request.reject(new Error("XYG_DISPOSED"));
  tickRequests.clear();
});
post("ready");
