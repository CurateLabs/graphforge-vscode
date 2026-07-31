/**
 * Structured, agent-copyable environment status (see issue #2). Kept free of
 * `vscode` imports so it can be unit tested directly under plain mocha.
 */
export interface EnvironmentReport {
  binding: {
    available: boolean;
    error?: string;
  };
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
  bindingAvailable: boolean,
  projectOpen: boolean,
): string {
  if (!bindingAvailable) {
    return 'Run "GraphForge: Setup Native Binding" to install or link @graphforge/node.';
  }
  if (!projectOpen) {
    return 'Run "GraphForge: Initialize Project Here" or "GraphForge: Open Project" to select a FORMAT project.';
  }
  return 'Ready — run "GraphForge: Run Query".';
}

/** Exactly 3 short lines: binding, project, next step. */
export function formatSummaryLines(report: EnvironmentReport): string[] {
  const bindingLine = report.binding.available
    ? "Binding: ok"
    : `Binding: missing${report.binding.error ? ` — ${report.binding.error}` : ""}`;
  const projectLine = report.project.open
    ? `Project: ${report.project.name ?? "(unnamed)"} (${report.project.path ?? "?"})`
    : "Project: none open";
  const nextLine = `Next: ${report.nextAction}`;
  return [bindingLine, projectLine, nextLine];
}
