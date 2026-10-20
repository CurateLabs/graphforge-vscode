import { QUALIFIED_CORE, type CoreQualification, type QualifiedCoreDeclaration } from "./coreQualification";
import type { ProjectKind } from "./projectKind";
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

/** Supported-Core declaration and per-runtime verdicts (#95). */
export interface CoreReport {
  declared: QualifiedCoreDeclaration;
  /** Verdict for the Node binding, when it is loaded. */
  node?: CoreQualification;
  /** Verdict for the Python graphforge, when importable. */
  python?: CoreQualification;
}

export interface EnvironmentReport {
  runtime: {
    /** `graphforge.runtime` setting: auto | node | python. */
    preference: RuntimePreference;
    /** Backend actually servicing the open session, if any. */
    active: RuntimeKind | "none";
    /**
     * What kind of workspace this looks like — `python` (prefers Python in
     * `auto`), `node`, or `ambiguous` (Node stays default in `auto`). See
     * `projectKind.ts`.
     */
    projectKind: ProjectKind;
  };
  /** Legacy top-level field (#2); mirrors `runtime` Node status. */
  nodeBinding: NodeBindingReport;
  python: PythonRuntimeStatus;
  /** Qualified Core range and whether each resolved runtime is within it (#95). */
  core: CoreReport;
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

export { QUALIFIED_CORE };

/**
 * Verdict for the runtime the next open will use: the active backend, or with
 * none open the runtime `chooseRuntime` would select. Without the fallback a
 * refused Core would be advised to "open a project" again (#95).
 */
export function coreVerdictFor(
  core: CoreReport,
  active: RuntimeKind | "none",
  selected: RuntimeKind | undefined,
): CoreQualification | undefined {
  const runtime = active === "none" ? selected : active;
  return runtime ? core[runtime] : undefined;
}

export function computeNextAction(
  nodeAvailable: boolean,
  pythonAvailable: boolean,
  projectOpen: boolean,
  active: RuntimeKind | "none",
  /** Verdict for the runtime that will be used; a non-qualified verdict leads the next action (#95). */
  coreIssue?: CoreQualification,
): string {
  if (coreIssue && coreIssue.status !== "qualified") {
    return `[${coreIssue.code}] ${coreIssue.message} ${coreIssue.nextAction}`;
  }
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
