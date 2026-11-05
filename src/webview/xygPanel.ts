import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as vscode from "vscode";
import type { QueryResult } from "../session/types";
import type { ProjectVisualizationSpec } from "../session/visualizationRegistry";
import type { EntityInspectSelection } from "./protocol";
import {
  graphForgeVizShowOptions,
  revealVizPanel,
  trackVizPanel,
} from "./panelColumn";
import {
  VisualizationInstanceLifecycle,
  visualizationInstances,
  visualizationInstanceId,
  type VisualizationController,
  type VisualizationKind,
} from "./visualizationInstanceRegistry";
import { loadXyg, graphInput, composeChart, composeMap } from "./xygRuntime";
import { resultRowsForGraphSelection } from "./resultTableModel";

export class XygVisualizationPanel implements VisualizationController {
  private static readonly selection = new vscode.EventEmitter<
    EntityInspectSelection & { source: QueryResult; projectRoot: string }
  >();
  static readonly onDidSelect = XygVisualizationPanel.selection.event;
  readonly lifecycle: VisualizationInstanceLifecycle;
  get renderGeneration() {
    return this.lifecycle.renderGeneration;
  }
  get kind(): VisualizationKind {
    return this.spec.kind === "result-graph" ? "graph" : this.spec.kind;
  }
  private owner: any;
  private payload: any;
  private figure: any;
  private composition: any;
  private xy: any;
  private selected: string[] = [];
  private frame = 0;
  private acceptedFrame = 0;
  private readonly acknowledgements = new Map<
    number,
    {
      resolve: () => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      payload: any;
    }
  >();
  private readyResolve: (value: Record<string, unknown>) => void;
  ready: Promise<Record<string, unknown>>;
  private readyTimer: ReturnType<typeof setTimeout> | undefined;
  private isReady = false;
  private readySettled = false;
  private disposed = false;
  private initialized = false;
  private reducedMotion = false;
  private width = 1100;
  private height = 650;
  private readonly listeners: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    public spec: ProjectVisualizationSpec,
    public result: QueryResult,
    private projectRoot: string,
    private base: QueryResult | undefined,
    public readonly instanceId: string,
    public readonly coordinationGroup?: string,
  ) {
    this.lifecycle = new VisualizationInstanceLifecycle(instanceId);
    let resolve!: (value: Record<string, unknown>) => void;
    this.ready = new Promise((r) => {
      resolve = r;
    });
    this.readyResolve = resolve;
    this.armReadyTimeout();
    trackVizPanel(panel);
    this.listeners.push(
      panel.onDidChangeViewState((e) => {
        if (e.webviewPanel.active) visualizationInstances.activate(instanceId);
      }),
    );
    this.listeners.push(
      panel.webview.onDidReceiveMessage((message) => {
        void this.receive(message);
      }),
    );
    panel.onDidDispose(() => {
      this.disposed = true;
      this.lifecycle.dispose();
      void this.owner?.dispose();
      this.rejectFrames();
      visualizationInstances.remove(instanceId);
      for (const d of this.listeners) d.dispose();
      this.settleReady({
        type: "graphforge/renderFailed",
        renderer: "xyg",
        code: "XYG_DISPOSED",
      });
    });
    this.listeners.push(vscode.window.onDidChangeActiveColorTheme(() => {
      if (this.initialized && !this.disposed) void this.render();
    }));
    panel.webview.html = this.html(panel.webview);
  }

  static show(
    extensionUri: vscode.Uri,
    spec: ProjectVisualizationSpec,
    result: QueryResult,
    projectRoot: string,
    artifactPath?: string,
    base?: QueryResult,
    coordinationGroup?: string,
  ) {
    const instanceId = visualizationInstanceId(
      spec.kind === "result-graph" ? "graph" : spec.kind,
      projectRoot,
      artifactPath,
    );
    const existing =
      visualizationInstances.get<XygVisualizationPanel>(instanceId);
    if (existing) {
      existing.spec = spec;
      existing.result = result;
      existing.projectRoot = projectRoot;
      existing.base = base;
      existing.selected = [];
      existing.reveal();
      if (existing.initialized) void existing.render();
      return { panel: existing, status: "updated" as const };
    }
    const panel = vscode.window.createWebviewPanel(
      "graphforge.xyg",
      `GraphForge: ${spec.name}`,
      graphForgeVizShowOptions(),
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );
    const controller = new XygVisualizationPanel(
      panel,
      extensionUri,
      spec,
      result,
      projectRoot,
      base,
      instanceId,
      coordinationGroup,
    );
    visualizationInstances.register(controller);
    return { panel: controller, status: "opened" as const };
  }
  static active() {
    return visualizationInstances.active<XygVisualizationPanel>();
  }
  reveal() {
    visualizationInstances.activate(this.instanceId);
    revealVizPanel(this.panel);
  }
  dispose() {
    this.panel.dispose();
  }
  private post(message: Record<string, unknown>) {
    if (!this.disposed)
      void this.panel.webview.postMessage({
        ...message,
        instanceId: this.instanceId,
        renderGeneration: this.renderGeneration,
      });
  }
  private rejectFrames() {
    for (const ack of this.acknowledgements.values()) {
      clearTimeout(ack.timer);
      ack.reject(new Error("XYG_RENDER_SUPERSEDED"));
    }
    this.acknowledgements.clear();
  }
  private async receive(message: any) {
    if (!message || typeof message.type !== "string") return;
    if (message.type === "ready" && !this.initialized) {
      this.initialized = true;
      this.reducedMotion = message.reducedMotion === true;
      await this.render();
      return;
    }
    if (!this.lifecycle.accepts(message)) return;
    if (message.type === "motionPreference" && typeof message.reducedMotion === "boolean") {
      this.reducedMotion = message.reducedMotion;
      await this.render();
      return;
    }
    if (
      message.type === "ticks" &&
      Number.isInteger(message.requestId) &&
      message.requestId > 0 &&
      Number.isInteger(message.frame) &&
      message.frame === this.frame
    ) {
      try {
        if (
          !(message.packet instanceof ArrayBuffer) ||
          message.packet.byteLength > 1024 * 1024
        )
          throw new Error("XYG_TICK_REQUEST_INVALID");
        const bytes = this.xy.tickResolvePacked(message.packet);
        this.post({
          type: "tickResult",
          requestId: message.requestId,
          frame: message.frame,
          packet: bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
        });
      } catch {
        this.post({
          type: "tickResult",
          requestId: message.requestId,
          frame: message.frame,
          error: "XYG_TICK_RESOLVE_FAILED",
        });
      }
      return;
    }
    if (
      message.type === "diagnostic" &&
      [
        "client-loaded",
        "view-created",
        "worker-started",
        "worker-ready",
        "ticks-ready",
        "painted",
      ].includes(message.phase)
    ) {
      console.info(
        "[GraphForge XYG]",
        this.instanceId,
        this.renderGeneration,
        message.phase,
      );
      return;
    }
    if (message.type === "painted" && Number.isInteger(message.frame)) {
      const ack = this.acknowledgements.get(message.frame);
      if (ack) {
        this.payload = ack.payload;
        this.acceptedFrame = message.frame;
        clearTimeout(ack.timer);
        this.acknowledgements.delete(message.frame);
        ack.resolve();
      }
      return;
    }
    if (message.type === "failed") {
      this.rejectFrames();
      this.fail(
        Object.assign(new Error("XYG paint failed."), {
          code:
            typeof message.code === "string"
              ? message.code
              : "XYG_PAINT_FAILED",
        }),
      );
      return;
    }
    if (message.type === "relayout") {
      await this.render();
      return;
    }
    if (message.type === "export") {
      try {
        await this.exportPair();
      } catch (error) {
        this.post({
          type: "notice",
          message: error instanceof Error ? error.message : "XYG_EXPORT_FAILED",
        });
      }
      return;
    }
    if (message.type === "pick" && message.frame === this.acceptedFrame) {
      if (
        !Number.isInteger(message.trace) ||
        !Number.isInteger(message.index) ||
        message.index < 0
      )
        return;
      if (this.spec.kind === "result-graph" && this.payload) {
        this.composition ??= this.xy.composeGraphForge(
          graphInput(this.spec, this.result, this.base),
        );
        const identity = this.xy.graphforgePick(
          this.payload,
          this.composition,
          { trace: message.trace, index: message.index },
        );
        if (
          identity?.uuid &&
          (identity.kind === "node" || identity.kind === "edge")
        ) {
          const item =
            identity.kind === "node"
              ? { id: identity.uuid, labels: [], properties: {} }
              : { id: identity.uuid, type: "", source: "", target: "" };
          XygVisualizationPanel.selection.fire({
            kind: identity.kind,
            item,
            source: this.result,
            projectRoot: this.projectRoot,
          } as EntityInspectSelection & {
            source: QueryResult;
            projectRoot: string;
          });
          this.selected = [identity.uuid];
          this.post({
            type: "notice",
            message: `Selected ${identity.kind} ${identity.uuid}`,
          });
        }
      }
    }
  }
  private async paint(payload: any, generation: number, painter = false) {
    if (generation !== this.renderGeneration || this.disposed) return;
    const frame = ++this.frame;
    const accepted = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.acknowledgements.delete(frame);
        reject(
          Object.assign(new Error("XYG paint acknowledgement timed out."), {
            code: "XYG_PAINT_TIMEOUT",
          }),
        );
      }, 20000);
      this.acknowledgements.set(frame, { resolve, reject, timer, payload });
    });
    this.post({
      type: "frame",
      frame,
      spec: payload.spec,
      buffer: payload.buffer,
      painter,
      phase: payload.phase ?? "complete",
    });
    await accepted;
  }
  private async render() {
    this.rejectFrames();
    this.isReady = false;
    this.acceptedFrame = 0;
    // A theme/re-layout can supersede work while a caller waits. Keep that
    // pending waiter until the current generation paints or fails.
    if (this.readySettled) {
      this.readySettled = false;
      this.ready = new Promise((resolve) => {
        this.readyResolve = resolve;
      });
    }
    this.armReadyTimeout();
    const { signal, context } = this.lifecycle.beginRender();
    const generation = context.renderGeneration;
    this.composition = undefined;
    this.post({
      type: "status",
      message: "Preparing XYG…",
      title: this.spec.name,
      ready: false,
      exportAvailable: this.spec.kind !== "temporal",
    });
    try {
      this.xy = await loadXyg(this.extensionUri.fsPath);
      if (signal.aborted || this.disposed) return;
      const theme =
        vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ||
          vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrastLight
          ? "light"
          : "dark";
      if (this.spec.kind === "result-graph") {
        this.owner ??= new this.xy.GraphForgeLayoutController();
        const input = graphInput(
          this.spec,
          this.result,
          this.base,
          this.selected,
        );
        this.payload = await this.owner.render(input, {
          width: this.width,
          height: this.height,
          theme,
          title: this.spec.name,
          layout: this.spec.graph!.layout,
          iterations: this.spec.graph!.iterations,
          signal,
          onPayload: (payload: any) => {
            if (!this.reducedMotion || payload.phase === "complete")
              return this.paint(payload, generation);
          },
        });
      } else if (this.spec.kind === "geospatial") {
        this.figure = composeMap(
          this.xy,
          this.spec,
          this.result,
          this.width,
          this.height,
        );
        const compiled = this.figure.compile();
        const buffer = this.xy.sceneBrowserPainter(
          new Uint8Array(compiled.scene),
        );
        await this.paint(
          {
            buffer: buffer.buffer.slice(
              buffer.byteOffset,
              buffer.byteOffset + buffer.byteLength,
            ),
          },
          generation,
          true,
        );
      } else {
        this.figure = composeChart(
          this.xy,
          this.spec,
          this.result,
          this.width,
          this.height,
          theme,
        );
        const payload = this.figure.buildPayload();
        const buffer =
          payload.buffers instanceof Uint8Array
            ? payload.buffers
            : new Uint8Array(payload.buffers);
        await this.paint(
          {
            spec: payload.spec,
            buffer: buffer.buffer.slice(
              buffer.byteOffset,
              buffer.byteOffset + buffer.byteLength,
            ),
          },
          generation,
        );
      }
      if (signal.aborted || this.disposed) return;
      const lifecycle = {
        type: "graphforge/renderReady",
        renderer: "xyg",
        instanceId: this.instanceId,
        renderGeneration: generation,
        nodeCount: this.payload?.positions?.uuid.length ?? 0,
        rowCount: this.result.rowCount,
        reducedMotion: this.reducedMotion,
      };
      this.post({
        type: "status",
        message: `XYG ready · ${this.result.rowCount.toLocaleString()} result rows`,
        ready: true,
        exportAvailable: this.spec.kind !== "temporal",
      });
      this.isReady = true;
      this.settleReady(lifecycle);
    } catch (error) {
      if (!signal.aborted && !this.disposed) this.fail(error);
    }
  }
  private armReadyTimeout() {
    clearTimeout(this.readyTimer);
    this.readyTimer = setTimeout(
      () =>
        this.fail(
          Object.assign(new Error("XYG readiness timed out."), {
            code: "XYG_READY_TIMEOUT",
          }),
        ),
      60000,
    );
  }
  private settleReady(value: Record<string, unknown>) {
    clearTimeout(this.readyTimer);
    this.readySettled = true;
    this.readyResolve(value);
  }
  private fail(error: unknown) {
    this.isReady = false;
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "XYG_RENDER_FAILED";
    const message =
      error instanceof Error
        ? error.message
        : "XYG could not render this result.";
    this.post({ type: "error", code, message });
    this.settleReady({
      type: "graphforge/renderFailed",
      renderer: "xyg",
      code,
      message,
      instanceId: this.instanceId,
      renderGeneration: this.renderGeneration,
    });
  }
  highlightFromResult(result: QueryResult, rowIndex: number, column?: string) {
    if (
      result !== this.result ||
      !result.rows[rowIndex] ||
      this.spec.kind !== "result-graph"
    )
      return { nodeIds: [], edgeIds: [] };
    const row = result.rows[rowIndex];
    const values = column ? [row[column]] : Object.values(row);
    const ids: string[] = [];
    const visit = (v: unknown) => {
      if (v && typeof v === "object") {
        for (const [key, value] of Object.entries(v)) {
          if (
            (key === "node_uuid" || key === "edge_uuid") &&
            typeof value === "string"
          )
            ids.push(value);
          else visit(value);
        }
      }
    };
    values.forEach(visit);
    this.selected = ids;
    if (ids.length) void this.render();
    return { nodeIds: ids, edgeIds: [] };
  }
  rowsForSelection(selection: EntityInspectSelection) {
    return resultRowsForGraphSelection(this.result, selection);
  }
  async exportPair() {
    if (!this.isReady || this.disposed) throw new Error("XYG_EXPORT_NOT_READY");
    if (this.spec.kind === "result-graph") {
      const composition = this.xy.composeGraphForge(
        graphInput(this.spec, this.result, this.base, this.selected),
      );
      this.figure = this.xy.graphforgeStaticPayload(composition, {
        width: this.width,
        height: this.height,
        title: this.spec.name,
        positions: this.payload.positions,
        layout: "preset",
      }).figure;
    }
    if (!this.figure) throw new Error("XYG_EXPORT_NOT_READY");
    const directory = path.join(this.projectRoot, "visualizations", "exports");
    await fs.mkdir(directory, { recursive: true });
    const stem =
      this.spec.name.replace(/[^a-zA-Z0-9_-]+/g, "-") || "visualization";
    const figure = this.figure;
    const svg = await figure.toImage("svg");
    let png: any;
    const bytes = (value: any) =>
      typeof value === "string" ? Buffer.from(value) : (value.bytes ?? value);
    const svgPath = path.join(directory, stem + ".svg"),
      pngPath = path.join(directory, stem + ".png");
    try {
      png = await figure.toImage("png");
      await fs.writeFile(svgPath, bytes(svg));
      await fs.writeFile(pngPath, bytes(png));
    } finally {
      await svg?.dispose?.();
      await png?.dispose?.();
    }
    this.post({
      type: "notice",
      message: "Saved PNG and SVG in visualizations/exports.",
    });
    return { svgPath, pngPath };
  }
  private html(webview: vscode.Webview) {
    const nonce = crypto.randomBytes(24).toString("base64");
    const uri = (...parts: string[]) =>
      webview
        .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", ...parts))
        .toString();
    const config = JSON.stringify({
      clientUri: uri("xyg", "client", "index.js"),
    }).replace(/</g, "\\u003c");
    return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource} 'nonce-${nonce}' 'wasm-unsafe-eval'; worker-src ${webview.cspSource} blob:; connect-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${uri("webview-ui", "xyg.css")}"></head><body><header><h1 id="title"></h1><span id="status" role="status">Loading XYG…</span><nav aria-label="Visualization controls"><button id="fit" disabled>Fit</button><button id="relayout" disabled>Re-layout</button><button id="export" disabled>Save PNG + SVG</button></nav></header><p id="notice" role="status"></p><main id="chart" aria-label="XYG visualization"></main><script id="xyg-config" type="application/json" nonce="${nonce}">${config}</script><script type="module" nonce="${nonce}" src="${uri("webview-ui", "xyg.js")}"></script></body></html>`;
  }
}
