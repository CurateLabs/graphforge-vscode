import type { PythonRuntimeStatus, RuntimeKind, RuntimePreference } from "./types";

/**
 * Structured, agent-copyable environment status (see issue #2, extended by
 * #12 for dual-runtime reporting). Kept free of `vscode` imports so it can
 * be unit tested directly under plain mocha.
 */
export interface NodeBindingReport {
  available: boolean;
  error?: string;
}

export interface EnvironmentReport {
  runtime: {
    /** `graphforge.runtime` setting: auto | node | python. */
    preference: RuntimePreference;
    /** Backend actually servicing the open session, if any. */
    active: RuntimeKind | "none";
  };
  /** Legacy top-level field (#2); mirrors `runtime` Node status. */
  nodeBinding: NodeBindingReport;
  python: PythonRuntimeStatus;
  project: {
    open: boolean;
    path?: string;
    name?: string;
    ontologyMode?: string;
  };
  /** Human-readable next step; also useful as an agent-facing action hint. */
  nextAction: string;
  timestamp: string;
}

export function computeNextAction(
  nodeAvailable: boolean,
  pythonAvailable: boolean,
  projectOpen: boolean,
  active: RuntimeKind | "none",
): string {
  if (active === "none") {
    if (!nodeAvailable && !pythonAvailable) {
      return 'Run "GraphForge: Setup Native Binding" or "GraphForge: Setup Python Binding" — no runtime is usable yet.';
    }
    if (!nodeAvailable && pythonAvailable) {
      return 'Python is available but not yet selected. Run "GraphForge: Open Project" (uses Python automatically) or set graphforge.runtime.';
    }
  }
  if (!projectOpen) {
    return 'Run "GraphForge: Initialize Project Here" or "GraphForge: Open Project" to select a FORMAT project.';
  }
  return 'Ready — run "GraphForge: Run Query".';
}

/** Exactly 3 short lines: runtime (Node + Python), project, next step. */
export function formatSummaryLines(report: EnvironmentReport): string[] {
  const nodeStatus = report.nodeBinding.available ? "ok" : "missing";
  const pythonStatus = report.python.available
    ? `ok${report.python.graphforgeVersion ? ` (${report.python.graphforgeVersion})` : ""}`
    : "missing";
  const activeLabel = report.runtime.active === "none" ? "none" : report.runtime.active;
  const runtimeLine = `Runtime: ${activeLabel} (pref: ${report.runtime.preference}) — Node: ${nodeStatus}, Python: ${pythonStatus}`;
  const projectLine = report.project.open
    ? `Project: ${report.project.name ?? "(unnamed)"} (${report.project.path ?? "?"})`
    : "Project: none open";
  const nextLine = `Next: ${report.nextAction}`;
  return [runtimeLine, projectLine, nextLine];
}
