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
