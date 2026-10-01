/** Injected by VS Code into every webview. */
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

/** Side-effect CSS imports handled by Vite; declared so tsc resolves them. */
declare module "*.css";

/** Vite inlines workers as blob URLs so they share the VS Code webview origin. */
declare module "*?worker&inline" {
  const WorkerConstructor: {
    new (options?: WorkerOptions): Worker;
  };
  export default WorkerConstructor;
}

/** Bundled Plotly UMD build used by the Figure webview (#62). */
declare module "plotly.js/dist/plotly.min.js" {
  type PlotlyModule = {
    react(
      root: HTMLElement,
      data: unknown[],
      layout?: Record<string, unknown>,
      config?: Record<string, unknown>,
    ): Promise<unknown>;
    newPlot(
      root: HTMLElement,
      data: unknown[],
      layout?: Record<string, unknown>,
      config?: Record<string, unknown>,
    ): Promise<unknown>;
    Plots: { resize(root: HTMLElement): Promise<unknown> };
  };
  const Plotly: PlotlyModule;
  export default Plotly;
}

/**
 * XYG browser paint client (`@curatelabs/xyg`, #80). The package ships no
 * type declarations; these cover only the surface the XYG webview uses.
 */
declare module "@curatelabs/xyg" {
  export interface XygView {
    readonly root: HTMLElement;
    destroy(): void;
  }
  export interface XygWasmWorker {
    /** Resolves once the WASM module is instantiated and version-checked. */
    readonly ready: Promise<unknown>;
  }
  export interface XygBrowserIdentity {
    kind: "node" | "edge";
    index: number;
    uuid: string | null;
    source?: string;
    target?: string;
    layers: { layer: number; resultId: string | null; row: number }[];
  }
  export interface XygBrowserComposition {
    readonly kind: string;
    readonly nodeUuid: string[];
    readonly edgeUuid: (string | null)[];
    readonly layers: {
      resultId: string | null;
      nodeRows: BigUint64Array | null;
      edgeRows: BigUint64Array | null;
    }[];
    identify(kind: "node" | "edge", index: number): XygBrowserIdentity;
  }
  export function renderStandalone(el: HTMLElement, spec: unknown, buffer: ArrayBuffer): XygView;
  export function createXygWasmWorker(options: {
    workerUrl: string;
    wasm: Uint8Array;
    maxArenaBytes?: number;
  }): XygWasmWorker;
  export function renderWasmGraphForge(options: {
    el: HTMLElement;
    worker: XygWasmWorker;
    width: number;
    height: number;
    theme?: "light" | "dark";
    input: unknown;
  }): Promise<{ view: XygView; composition: XygBrowserComposition }>;
  export function composeWasmGraphForge(
    worker: XygWasmWorker,
    input: unknown,
  ): { result: Promise<XygBrowserComposition> };
  export function graphforgeTableElement(composition: XygBrowserComposition): HTMLTableElement;
}
