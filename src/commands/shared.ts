import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import { GetStartedViewProvider, revealGetStarted } from "../views/getStartedView";
import { engineErrorCode, errorMessage, presentError } from "./errorPresentation";

// Pure helpers live in `errorPresentation.ts` (vscode-free, unit tested);
// re-exported here so existing command imports keep working.
export { engineErrorCode, errorMessage, presentError } from "./errorPresentation";

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
export const SHOW_ERROR_DETAILS = "Show Details";

let errorChannel: vscode.OutputChannel | undefined;

/** Lazily created channel that keeps full raw diagnostics out of toasts without losing them. */
function errorOutput(): vscode.OutputChannel {
  errorChannel ??= vscode.window.createOutputChannel("GraphForge Errors");
  return errorChannel;
}

/** Append full raw diagnostics for a failure to the error output channel. */
export function logErrorDetail(what: string, err: unknown, extraDetail?: string): void {
  const presented = presentError(err);
  const channel = errorOutput();
  channel.appendLine(
    `[${new Date().toISOString()}] ${what}${presented.code ? ` [${presented.code}]` : ""}`,
  );
  if (extraDetail) {
    channel.appendLine(extraDetail);
  }
  channel.appendLine(presented.detail);
}

/**
 * Single curated error reporter for command catch blocks (#28):
 *
 * - Warning-class errors (`UnsupportedByBindingError`, `NodeOnlyFeatureError`
 *   — policy facts that name their own fix, #38) get a soft
 *   `showWarningMessage`, never a red error toast.
 * - Setup/runtime failures get a short toast with the existing recovery
 *   action buttons (Setup Native / Setup Python).
 * - Everything else (query/user-input failures) gets a concise one-line
 *   toast with a "Show Details" button; the full raw message goes to the
 *   "GraphForge Errors" output channel.
 *
 * Returns the structured `{ error, code }` shape — with the *full* raw
 * message, not the curated one — so command handlers stay agent-copyable.
 * Toasts are fire-and-forget: never awaited, so headless runs can't hang.
 */
export function reportEngineError(
  what: string,
  err: unknown,
  extraDetail?: string,
): { error: string; code?: string } {
  const presented = presentError(err);
  logErrorDetail(what, err, extraDetail);

  if (presented.severity === "warning") {
    void vscode.window.showWarningMessage(`GraphForge: ${presented.message}`);
    return { error: presented.detail, code: presented.code };
  }

  if (presented.setup) {
    void vscode.window
      .showErrorMessage(
        `GraphForge: ${what} — ${presented.message}`,
        RECOVERY_SETUP_NATIVE,
        RECOVERY_SETUP_PYTHON,
      )
      .then((action) => {
        if (action === RECOVERY_SETUP_NATIVE) {
          return vscode.commands.executeCommand("graphforge.setupNativeBinding");
        }
        if (action === RECOVERY_SETUP_PYTHON) {
          return vscode.commands.executeCommand("graphforge.setupPythonBinding");
        }
        return undefined;
      });
    return { error: presented.detail, code: presented.code };
  }

  void vscode.window
    .showErrorMessage(
      `GraphForge: ${what} — ${presented.message}${presented.code ? ` [${presented.code}]` : ""}`,
      SHOW_ERROR_DETAILS,
    )
    .then((action) => {
      if (action === SHOW_ERROR_DETAILS) {
        errorOutput().show(true);
      }
      return undefined;
    });
  return { error: presented.detail, code: presented.code };
}

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
