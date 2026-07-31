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

/** Short labels for `showErrorMessage` action buttons (toast space is tight). */
export const RECOVERY_SETUP_NATIVE = "Setup Native (Node)";
export const RECOVERY_SETUP_PYTHON = "Setup Python";
export const RECOVERY_OPEN_PROJECT = "Open Project";
export const RECOVERY_INIT_PROJECT = "Initialize";
export const RECOVERY_CHECK_ENV = "$(refresh)";

/**
 * Structured, agent-copyable failure shape returned by command handlers when
 * setup is incomplete (see `docs/experience/agent-interop.md` #3: fail
 * closed with an actionable `nextAction` instead of a bare throw).
 */
export interface SetupRecovery {
  error: string;
  code?: string;
  nextAction: string;
}

/** Human-readable next command an agent (or human) should run to unblock setup (#12: covers both runtimes). */
export async function nextSetupAction(session: GraphForgeSession): Promise<string> {
  const hasRuntime = await session.hasUsableRuntime();
  return hasRuntime
    ? 'Run "GraphForge: Open Project" (graphforge.openProject) or "GraphForge: Initialize Project Here" (graphforge.initializeProjectHere).'
    : 'Run "GraphForge: Setup Native Binding" (graphforge.setupNativeBinding) or "GraphForge: Setup Python Binding" (graphforge.setupPythonBinding).';
}

/**
 * Show a setup/project-open failure with a next-step action button instead of
 * a dead-end toast (per #2/#3 UX doctrine: never a vague failure), and return
 * a structured `SetupRecovery` describing the failure and next action.
 *
 * The notification itself is fire-and-forget: callers (including
 * `vscode.commands.executeCommand` from another extension or a coding agent)
 * must not block on a human dismissing a dialog, so the returned promise
 * resolves immediately with the structured recovery info while the
 * notification and its follow-up command (if any) resolve in the
 * background.
 */
export async function offerSetupRecovery(
  session: GraphForgeSession,
  err: unknown,
): Promise<SetupRecovery> {
  const code = engineErrorCode(err);
  const message = errorMessage(err);
  const hasRuntime = await session.hasUsableRuntime();
  const primary = hasRuntime ? RECOVERY_OPEN_PROJECT : RECOVERY_SETUP_NATIVE;
  const buttons = hasRuntime
    ? [primary, RECOVERY_INIT_PROJECT, RECOVERY_CHECK_ENV]
    : [primary, RECOVERY_SETUP_PYTHON, RECOVERY_CHECK_ENV];
  // Fire-and-forget: callers (including `executeCommand` from another
  // extension or a coding agent) must not block on a human dismissing a
  // dialog, so this resolves immediately with the structured recovery info
  // while the notification and its follow-up command (if any) resolve in
  // the background.
  void vscode.window
    .showErrorMessage(`GraphForge: ${message}${code ? ` [${code}]` : ""}`, ...buttons)
    .then((choice) => {
      if (choice === RECOVERY_SETUP_NATIVE) {
        void vscode.commands.executeCommand("graphforge.setupNativeBinding");
      } else if (choice === RECOVERY_SETUP_PYTHON) {
        void vscode.commands.executeCommand("graphforge.setupPythonBinding");
      } else if (choice === RECOVERY_OPEN_PROJECT) {
        void vscode.commands.executeCommand("graphforge.openProject");
      } else if (choice === RECOVERY_INIT_PROJECT) {
        void vscode.commands.executeCommand("graphforge.initializeProjectHere");
      } else if (choice === RECOVERY_CHECK_ENV) {
        void vscode.commands.executeCommand("graphforge.checkEnvironment");
      }
    });
  return { error: message, code, nextAction: await nextSetupAction(session) };
}

/** Gate commands that need an open project; returns structured recovery on failure. */
export async function ensureProjectOrRecover(
  session: GraphForgeSession,
): Promise<SetupRecovery | undefined> {
  try {
    await session.ensureProject();
    return undefined;
  } catch (err) {
    return offerSetupRecovery(session, err);
  }
}

/** Boolean gate for handlers that only need to know whether a project is ready. */
export async function ensureProjectReady(session: GraphForgeSession): Promise<boolean> {
  return (await ensureProjectOrRecover(session)) === undefined;
}
