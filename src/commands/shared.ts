import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";

/** Extract the engine fault-domain code (e.g. `GF_UNSUPPORTED_PROJECT_FORMAT`) when present. */
export function engineErrorCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.startsWith("GF_")) {
      return code;
    }
  }
  return undefined;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Short, single-line, whitespace-collapsed preview of a query for error toasts. */
export function querySnippet(text: string, max = 80): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * Show a setup/project-open failure with a next-step action button instead of
 * a dead-end toast (per #2/#3 UX doctrine: never a vague failure).
 */
export async function offerSetupRecovery(
  session: GraphForgeSession,
  err: unknown,
): Promise<void> {
  const code = engineErrorCode(err);
  const message = errorMessage(err);
  const primary = session.bindingAvailable
    ? "Open Project"
    : "Setup Native Binding";
  const choice = await vscode.window.showErrorMessage(
    `GraphForge: ${message}${code ? ` [${code}]` : ""}`,
    primary,
    "Check Environment",
  );
  if (choice === "Setup Native Binding") {
    await vscode.commands.executeCommand("graphforge.setupNativeBinding");
  } else if (choice === "Open Project") {
    await vscode.commands.executeCommand("graphforge.openProject");
  } else if (choice === "Check Environment") {
    await vscode.commands.executeCommand("graphforge.checkEnvironment");
  }
}
