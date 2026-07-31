import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import { GetStartedViewProvider, revealGetStarted } from "../views/getStartedView";

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
 * One-line toast copy for setup recovery. Full diagnostics belong in Check
 * Environment (JSON) or the status-bar tooltip — not in `showErrorMessage`.
 */
export function recoveryToastMessage(err: unknown, max = 120): string {
  const message = errorMessage(err);
  if (message.startsWith("No usable GraphForge runtime")) {
    return "No usable GraphForge runtime.";
  }
  if (message.includes("Cannot find module") || message.includes("Require stack:")) {
    return "No usable GraphForge runtime.";
  }
  const oneLine = message.split(/\r?\n/)[0]?.trim() ?? message;
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
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
 * Open the Get Started sidebar (primary human recovery surface) and return
 * structured recovery info for agents. Toasts are omitted — the panel has
 * the same actions with room for short copy, not stack traces.
 */
export async function offerSetupRecovery(
  session: GraphForgeSession,
  err: unknown,
): Promise<SetupRecovery> {
  const code = engineErrorCode(err);
  const message = errorMessage(err);
  const provider = GetStartedViewProvider.instance;
  if (provider) {
    await revealGetStarted(provider);
  } else {
    void vscode.commands.executeCommand("graphforge.getStarted");
  }
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
