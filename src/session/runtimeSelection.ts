import type { PythonRuntimeStatus, RuntimeKind, RuntimePreference } from "./types";

/**
 * Pure runtime-selection logic (#12), split out of `runtime.ts` so it can be
 * unit tested directly under plain mocha without a `vscode` dependency
 * (same convention as `environmentReport.ts` / `arrowCodec.ts`).
 */
export interface NodeBindingStatus {
  available: boolean;
  error?: string;
}

/** Which runtime `auto`/explicit preference would pick, given current availability. */
export function chooseRuntime(
  preference: RuntimePreference,
  node: NodeBindingStatus,
  python: PythonRuntimeStatus,
): RuntimeKind | undefined {
  if (preference === "node") {
    return node.available ? "node" : undefined;
  }
  if (preference === "python") {
    return python.available ? "python" : undefined;
  }
  if (node.available) {
    return "node";
  }
  if (python.available) {
    return "python";
  }
  return undefined;
}

/**
 * Single actionable, fail-closed message covering both setup paths (#12
 * requirement: "errors must explain both paths"). Used whether the chosen
 * preference's runtime is missing or neither runtime is usable.
 */
export function describeRuntimeUnavailable(
  preference: RuntimePreference,
  node: NodeBindingStatus,
  python: PythonRuntimeStatus,
): string {
  const nodePart = node.available
    ? "Node: ok"
    : `Node: unavailable — ${node.error ?? "no binding"}. Run "GraphForge: Setup Native Binding".`;
  const pythonPart = python.available
    ? `Python: ok (${python.interpreter ?? "interpreter"})`
    : `Python: unavailable — ${python.error ?? "no interpreter"}. Run "GraphForge: Setup Python Binding".`;
  return `No usable GraphForge runtime for preference "${preference}". ${nodePart} ${pythonPart}`;
}
