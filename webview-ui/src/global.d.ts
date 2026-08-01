/** Injected by VS Code into every webview. */
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

/** Side-effect CSS imports handled by Vite; declared so tsc resolves them. */
declare module "*.css";
