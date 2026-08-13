import type { ProjectKind } from "./projectKind";
import type { PythonRuntimeStatus, RuntimeKind, RuntimePreference } from "./types";

export type { ProjectKind } from "./projectKind";

/**
 * Pure runtime-selection logic (#12), split out of `runtime.ts` so it can be
 * unit tested directly under plain mocha without a `vscode` dependency
 * (same convention as `environmentReport.ts` / `arrowCodec.ts`).
 */
export interface NodeBindingStatus {
  available: boolean;
  error?: string;
}

/**
 * Which runtime `auto`/explicit preference would pick, given current
 * availability and (for `auto` only) what kind of project this looks like.
 *
 * `projectKind` defaults to `"ambiguous"` — the pre-existing "Node always
 * wins in auto" behavior — so every existing call site keeps working
 * unchanged. When the workspace looks Python-first (`projectKind ===
 * "python"`) and Python is actually usable, `auto` prefers Python over Node
 * even when the Node binding is available; Node remains the default in
 * every other case (Node-ish or ambiguous repos, or explicit `node`/`python`
 * preference, which never fall back to the other runtime regardless of
 * project kind).
 */
export function chooseRuntime(
  preference: RuntimePreference,
  node: NodeBindingStatus,
  python: PythonRuntimeStatus,
  projectKind: ProjectKind = "ambiguous",
): RuntimeKind | undefined {
  if (preference === "node") {
    return node.available ? "node" : undefined;
  }
  if (preference === "python") {
    return python.available ? "python" : undefined;
  }
  if (projectKind === "python" && python.available) {
    return "python";
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
 * Curated one-phrase summary of why the Node binding is unavailable (#27).
 * Raw loader diagnostics (`Cannot find module … Require stack:` dumps, the
 * joined multi-candidate `Tried: …` list) never surface here — they stay
 * available in full via "GraphForge: Check Environment" (JSON).
 */
export function summarizeNodeUnavailable(error: string | undefined): string {
  if (!error) {
    return "binding not detected";
  }
  if (error.includes("no GraphForge export")) {
    return "installed module has no GraphForge export";
  }
  if (error.includes("Cannot find module") || error.includes("Require stack:")) {
    return "@curatelabs/graphforge is not installed or linked";
  }
  return "binding failed to load";
}

/**
 * Curated one-phrase summary of why the Python runtime is unavailable (#27,
 * audit follow-up): the raw `python.error` joins every candidate
 * interpreter's probe failure into one blob, which must never reach the
 * status-bar tooltip or a toast.
 */
export function summarizePythonUnavailable(error: string | undefined): string {
  if (!error) {
    return "no interpreter";
  }
  if (error.startsWith("No Python interpreter detected")) {
    return "no Python interpreter detected";
  }
  if (error.includes("graphforge not importable")) {
    return "graphforge is not installed in the detected interpreter(s)";
  }
  return "runtime failed to load";
}

/**
 * Single actionable, fail-closed message covering both setup paths (#12
 * requirement: "errors must explain both paths"). Used whether the chosen
 * preference's runtime is missing or neither runtime is usable.
 *
 * Curated to at most 3 short lines (#27): what is missing per runtime plus
 * the named recovery command — never raw `require()` / interpreter-probe
 * diagnostics. Full diagnostics remain available via "GraphForge: Check
 * Environment" (JSON report).
 */
export function describeRuntimeUnavailable(
  preference: RuntimePreference,
  node: NodeBindingStatus,
  python: PythonRuntimeStatus,
): string {
  const nodePart = node.available
    ? "Node: ok"
    : `Node: ${summarizeNodeUnavailable(node.error)} — run "GraphForge: Setup Native Binding".`;
  const pythonPart = python.available
    ? `Python: ok (${python.interpreter ?? "interpreter"})`
    : `Python: ${summarizePythonUnavailable(python.error)} — run "GraphForge: Setup Python Binding".`;
  return [
    `No usable GraphForge runtime (preference "${preference}") — full diagnostics: "GraphForge: Check Environment".`,
    nodePart,
    pythonPart,
  ].join("\n");
}
