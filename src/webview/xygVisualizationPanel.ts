import * as crypto from "node:crypto";
import * as vscode from "vscode";
import type { QueryResult } from "../session/types";
import {
  composeInput,
  intentNeedsBase,
  loadXygNative,
  pickRows,
  rowIdentities,
  toXygError,
  XygVisualizationError,
  type XygComposition,
  type XygCompositionDiagnostics,
  type XygGraphForgeApi,
  type XygHost,
  type XygIdentity,
  type XygIntent,
  type XygWebviewPayload,
} from "../session/xygAdapter";
import { graphForgeVizShowOptions, revealVizPanel, trackVizPanel } from "./panelColumn";
import {
  visualizationInstanceId,
  visualizationInstances,
  VisualizationInstanceLifecycle,
  type VisualizationController,
} from "./visualizationInstanceRegistry";
import type {
  XygHostToWebview,
  XygPanelStatus,
  XygWebviewToHost,
} from "./xygProtocol";

/** Everything one XYG view needs: the result, its engine bytes, and intent. */
export interface XygVisualizationRequest {
  title: string;
  result: QueryResult;
  ipc: Uint8Array;
  intent: XygIntent;
  host: XygHost;
  /** Reads the base graph at a verified generation (graph intents only). */
  readBase: () => Promise<{ tables: Uint8Array[]; generation?: string }>;
}

/** Rows of one result picked in an XYG view (for Results table linking). */
export interface XygRowSelectionEvent {
  instanceId: string;
  resultId: string;
  generationUuid?: string;
  rows: number[];
}

/** What the webview reported after painting the current render. */
export type XygPaintReport =
  | { painted: true; durationMs: number }
  | { painted: false; code: string; message: string };

/** Value-free outcome returned to commands and agents. */
export interface XygVisualizationOutcome {
  instanceId: string;
  host: XygHost;
  intent: XygIntent;
  diagnostics?: XygCompositionDiagnostics;
  error?: { code: string; message: string; nextAction: string };
}

interface NativeState {
  api: XygGraphForgeApi;
  composition: XygComposition;
  payload?: XygWebviewPayload;
  rowIndex?: Map<number, string[]>;
}

/**
 * One XYG visualization of one GraphForge result (#80). Rust (XYG) composes,
 * lays out, and paints; this panel moves bytes, relays picks by UUID/result
 * row, and reports coded failures. It never falls back to another renderer.
 */
export class XygVisualizationPanel implements VisualizationController {
  public readonly kind = "xyg" as const;
  public readonly coordinationGroup = undefined;
  private readonly lifecycle: VisualizationInstanceLifecycle;
  public get renderGeneration(): number { return this.lifecycle.renderGeneration; }

  private static readonly rowSelectionEmitter = new vscode.EventEmitter<XygRowSelectionEvent>();
  public static readonly onDidSelectRows = XygVisualizationPanel.rowSelectionEmitter.event;

  private request: XygVisualizationRequest | undefined;
  private native: NativeState | undefined;
  private base: { tables: Uint8Array[]; generation?: string } | undefined;
  private viewport: { width: number; height: number; theme: "light" | "dark" } | undefined;
  private selected: string[] = [];
  private lastOutcome: XygVisualizationOutcome | undefined;
  private rendering: Promise<XygVisualizationOutcome> | undefined;
  private painting: Promise<void> | undefined;
  private paintWaiters: ((report: XygPaintReport) => void)[] = [];
  /** The latest paint report and the render generation it belongs to. */
  private lastPaint: { generation: number; report: XygPaintReport } | undefined;
  private viewportReady!: Promise<void>;
  private resolveViewport!: () => void;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    public readonly instanceId: string,
  ) {
    this.lifecycle = new VisualizationInstanceLifecycle(instanceId);
    this.resetViewportGate();
    trackVizPanel(panel);
    panel.onDidDispose(() => {
      visualizationInstances.remove(this.instanceId);
      this.lifecycle.dispose();
      this.native = undefined;
      this.base = undefined;
      this.request = undefined;
    });
    panel.onDidChangeViewState((event) => {
      if (event.webviewPanel.active) visualizationInstances.activate(this.instanceId);
    });
    panel.webview.onDidReceiveMessage((message: XygWebviewToHost) => {
      void this.onMessage(message);
    });
    panel.webview.html = this.getHtml(panel.webview, extensionUri);
  }

  /** Open (or update) the view for `request`; resolves once composed or failed. */
  static async show(
    extensionUri: vscode.Uri,
    request: XygVisualizationRequest,
    instanceId: string = visualizationInstanceId("xyg"),
  ): Promise<{ panel: XygVisualizationPanel; status: "opened" | "updated"; outcome: XygVisualizationOutcome }> {
    let panel = visualizationInstances.get<XygVisualizationPanel>(instanceId);
    let status: "opened" | "updated" = "updated";
    if (panel) {
      panel.reveal();
    } else {
      const webviewPanel = vscode.window.createWebviewPanel(
        "graphforge.xyg",
        `GraphForge: ${request.title}`,
        graphForgeVizShowOptions(),
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist", "webview-ui")],
        },
      );
      panel = visualizationInstances.register(new XygVisualizationPanel(webviewPanel, extensionUri, instanceId));
      status = "opened";
    }
    const outcome = await panel.update(request);
    return { panel, status, outcome };
  }

  /** The XYG view currently showing `resultId`, preferring the active one. */
  static forResult(resultId: string | undefined): XygVisualizationPanel | undefined {
    if (!resultId) return undefined;
    const active = visualizationInstances.active<XygVisualizationPanel>("xyg");
    if (active?.resultId === resultId) return active;
    return visualizationInstances
      .values<XygVisualizationPanel>("xyg")
      .find((panel) => panel.resultId === resultId);
  }

  get resultId(): string | undefined {
    return this.request?.result.provenance?.resultId;
  }

  get outcome(): XygVisualizationOutcome | undefined {
    return this.lastOutcome;
  }

  reveal(): void {
    visualizationInstances.activate(this.instanceId);
    revealVizPanel(this.panel);
  }

  dispose(): void {
    this.panel.dispose();
  }

  async update(request: XygVisualizationRequest): Promise<XygVisualizationOutcome> {
    this.request = request;
    this.native = undefined;
    this.base = undefined;
    this.selected = [];
    this.panel.title = `GraphForge: ${request.title}`;
    return this.render();
  }

  /**
   * Paint the given result rows as selected. Rust sets the selected state by
   * UUID (`select`), so the view recomposes with the same base and reuses its
   * layout. Returns how many composed identities the rows named.
   */
  async selectRows(rows: readonly number[]): Promise<number> {
    const request = this.request;
    if (!request) return 0;
    if (request.host === "wasm") {
      this.post({ ...this.context, type: "xyg.selectRows", rows: [...rows] });
      return rows.length;
    }
    const native = this.native;
    if (!native || native.composition.kind === "table") return 0;
    const resultId = this.resultId;
    if (!resultId) return 0;
    native.rowIndex ??= rowIdentities(native.composition, resultId);
    const uuids = [...new Set(rows.flatMap((row) => native.rowIndex?.get(row) ?? []))];
    if (uuids.length === 0) return 0;
    this.selected = uuids;
    await this.render();
    return uuids.length;
  }

  private get context(): { instanceId: string; renderGeneration: number } {
    return { instanceId: this.instanceId, renderGeneration: this.renderGeneration };
  }

  private resetViewportGate(): void {
    this.viewportReady = new Promise((resolve) => { this.resolveViewport = resolve; });
  }

  private status(phase: XygPanelStatus["phase"], extra: Partial<XygPanelStatus> = {}): XygPanelStatus {
    const request = this.request!;
    return { phase, title: request.title, host: request.host, intent: request.intent, ...extra };
  }

  private render(): Promise<XygVisualizationOutcome> {
    this.painting = undefined;
    const run = this.renderNow();
    this.rendering = run;
    return run;
  }

  private async renderNow(): Promise<XygVisualizationOutcome> {
    const request = this.request;
    if (!request) throw new Error("XYG visualization has no request.");
    const { context, signal } = this.lifecycle.beginRender();
    const started = performance.now();
    const resultId = request.result.provenance?.resultId;
    const outcomeBase = { instanceId: this.instanceId, host: request.host, intent: request.intent };
    this.post({ ...context, type: "xyg.status", status: this.status("prepare") });
    try {
      if (!resultId) {
        throw new XygVisualizationError(
          "GF_COMPOSE_REQUEST_INVALID",
          "This result has no result identity.",
          "Re-run the query or verb, then visualize it again.",
        );
      }
      if (intentNeedsBase(request.intent) && !this.base) {
        this.base = await request.readBase();
      }
      if (signal.aborted) return this.lastOutcome ?? outcomeBase;
      const input = composeInput({
        result: request.ipc,
        intent: request.intent,
        resultId,
        generation: request.result.provenance?.generationUuid,
        base: this.base,
        select: this.selected,
      });

      if (request.host === "wasm") {
        await this.viewportReady;
        if (signal.aborted) return this.lastOutcome ?? outcomeBase;
        this.post({
          ...context,
          type: "xyg.render",
          mode: "wasm",
          status: this.status("paint"),
          input: {
            ...input,
            base: input.base && { ...input.base, tables: input.base.tables.map((t) => new Uint8Array(t)) },
            layers: input.layers.map((l) => ({ ...l, result: new Uint8Array(l.result) })),
          },
          resultId,
        });
        this.lastOutcome = outcomeBase;
        return outcomeBase;
      }

      const loaded = await loadXygNative();
      if (!loaded.ok) throw toXygError(loaded);
      const composition = loaded.api.composeGraphForge(input);
      const diagnostics = composition.diagnostics();
      const previous = this.native?.payload?.positions;
      const statusExtra: Partial<XygPanelStatus> = {
        kind: composition.kind,
        nodes: diagnostics.nodes,
        edges: diagnostics.edges,
        rows: diagnostics.rows,
        decisions: diagnostics.decisions.map((d) => d.code),
      };
      if (composition.kind === "table") {
        this.native = { api: loaded.api, composition };
        this.post({
          ...context,
          type: "xyg.render",
          mode: "table",
          status: this.status("paint", statusExtra),
          html: loaded.api.graphforgeTableHtml(composition),
        });
      } else {
        this.native = { api: loaded.api, composition };
        // Paint needs the webview's size; composition (and its diagnostics)
        // does not, so the outcome is known before the webview reports in.
        this.painting = this.paint(loaded.api, composition, previous, statusExtra, context, signal, started);
      }
      this.lastOutcome = { ...outcomeBase, diagnostics };
      return this.lastOutcome;
    } catch (err) {
      const error = toXygError(err);
      this.native = undefined;
      this.post({
        ...context,
        type: "xyg.error",
        code: error.code,
        message: error.message.replace(` ${error.nextAction}`, ""),
        nextAction: error.nextAction,
        layer: error.layer,
        field: error.field,
      });
      this.lastOutcome = {
        ...outcomeBase,
        error: { code: error.code, message: error.message, nextAction: error.nextAction },
      };
      return this.lastOutcome;
    }
  }

  private async paint(
    api: XygGraphForgeApi,
    composition: XygComposition,
    positions: unknown,
    statusExtra: Partial<XygPanelStatus>,
    context: { instanceId: string; renderGeneration: number },
    signal: AbortSignal,
    started: number,
  ): Promise<void> {
    await this.viewportReady;
    if (signal.aborted || !this.viewport) return;
    try {
      const payload = api.graphforgeWebviewPayload(composition, {
        width: this.viewport.width,
        height: this.viewport.height,
        theme: this.viewport.theme,
        ...(positions ? { positions } : {}),
      });
      if (signal.aborted) return;
      this.native = { api, composition, payload };
      this.post({
        ...context,
        type: "xyg.render",
        mode: "native",
        status: this.status("paint", { ...statusExtra, durationMs: Math.round(performance.now() - started) }),
        spec: payload.spec,
        buffer: new Uint8Array(payload.buffer),
      });
    } catch (err) {
      const error = toXygError(err);
      this.post({
        ...context,
        type: "xyg.error",
        code: error.code,
        message: error.message.replace(` ${error.nextAction}`, ""),
        nextAction: error.nextAction,
        layer: error.layer,
        field: error.field,
      });
      if (this.request) {
        this.lastOutcome = {
          instanceId: this.instanceId,
          host: this.request.host,
          intent: this.request.intent,
          error: { code: error.code, message: error.message, nextAction: error.nextAction },
        };
      }
    }
  }

  private async onMessage(message: XygWebviewToHost): Promise<void> {
    if (message.type === "xyg.ready") {
      this.viewport = { width: message.width, height: message.height, theme: message.theme };
      this.resolveViewport();
      return;
    }
    if (message.type === "xyg.resize") {
      if (!this.viewport) return;
      const changed = message.width !== this.viewport.width || message.height !== this.viewport.height;
      this.viewport = { ...this.viewport, width: message.width, height: message.height };
      if (changed && this.request?.host === "native" && this.native?.payload) await this.render();
      return;
    }
    if (!this.lifecycle.accepts(message)) return;
    if (message.type === "xyg.rendered") {
      this.reportPaint({ painted: true, durationMs: message.durationMs });
      return;
    }
    if (message.type === "xyg.failed") {
      this.reportPaint({ painted: false, code: message.code, message: message.message });
    }
    if (message.type === "xyg.pick") {
      const native = this.native;
      if (!native?.payload) return;
      this.emitRows(native.api.graphforgePick(native.payload.figure, native.composition, message));
    } else if (message.type === "xyg.pickIdentity") {
      this.emitRows(message.identity);
    } else if (message.type === "xyg.failed" && this.request) {
      this.lastOutcome = {
        instanceId: this.instanceId,
        host: this.request.host,
        intent: this.request.intent,
        error: { code: message.code, message: message.message, nextAction: toXygError(message).nextAction },
      };
    }
  }

  private emitRows(pick: Parameters<typeof pickRows>[0] | XygIdentity): void {
    const resultId = this.resultId;
    if (!resultId) return;
    const rows = pickRows(pick, resultId);
    if (rows.length === 0) return;
    XygVisualizationPanel.rowSelectionEmitter.fire({
      instanceId: this.instanceId,
      resultId,
      generationUuid: this.request?.result.provenance?.generationUuid,
      rows,
    });
  }

  private post(message: XygHostToWebview): void {
    void this.panel.webview.postMessage(message);
  }

  /**
   * Resolves when the webview reports the current render painted or failed,
   * immediately if that report already arrived.
   */
  whenPainted(): Promise<XygPaintReport> {
    if (this.lastPaint?.generation === this.renderGeneration) {
      return Promise.resolve(this.lastPaint.report);
    }
    return new Promise((resolve) => this.paintWaiters.push(resolve));
  }

  private reportPaint(report: XygPaintReport): void {
    this.lastPaint = { generation: this.renderGeneration, report };
    const waiters = this.paintWaiters;
    this.paintWaiters = [];
    for (const resolve of waiters) resolve(report);
  }

  /** Waits for any in-flight composition and paint (used by tests and agent commands). */
  async settled(): Promise<XygVisualizationOutcome | undefined> {
    await this.rendering;
    await this.painting;
    return this.lastOutcome;
  }

  private getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const assets = vscode.Uri.joinPath(extensionUri, "dist", "webview-ui");
    const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(assets, name)).toString();
    const nonce = crypto.randomBytes(16).toString("base64url");
    // XYG integration note §4: nonce scripts, local assets only, WASM
    // compilation for the direct-browser host, Blob-URL module Worker, and
    // inline styles injected by the XYG paint client. No network access.
    const csp = [
      `default-src 'none'`,
      `script-src 'nonce-${nonce}' ${webview.cspSource} 'wasm-unsafe-eval'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `img-src ${webview.cspSource} data: blob:`,
      `font-src ${webview.cspSource}`,
      `connect-src ${webview.cspSource}`,
      `worker-src blob:`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${asset("xygVisualization.css")}" />
  <title>GraphForge XYG visualization</title>
</head>
<body>
  <main id="app" data-worker="${asset("xyg/wasm-worker.js")}" data-wasm="${asset("xyg/xyg-wasm.wasm")}">
    <p id="status" class="status" role="status" aria-live="polite">Preparing visualization…</p>
    <section id="error" class="error" role="alert" hidden></section>
    <div id="view" class="view" aria-label="GraphForge result visualization"></div>
    <div id="table" class="table" hidden></div>
  </main>
  <script type="module" nonce="${nonce}" src="${asset("xygVisualization.js")}"></script>
</body>
</html>`;
  }
}
