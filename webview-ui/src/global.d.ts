/** Injected by VS Code into every webview. */
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

/** Side-effect CSS imports handled by Vite; declared so tsc resolves them. */
declare module "*.css";

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
