import * as vscode from "vscode";
import { isCliAvailable, runGraphForgeCli } from "../session/graphforgeCli";
import {
  CommandOutcome,
  RECOVERY_SETUP_NATIVE,
} from "./shared";
import { reportEngineError } from "./shared";

/**
 * `GraphForge: Run CLI…` (Part F) — surfaces the engine-owned repository
 * lifecycle CLI (`@curatelabs/graphforge-cli`) in-process via the native
 * binding's `runCli`. Agents pass `{ args }` to skip the picker; the result is
 * structured (agent-interop parity, #55) and stdout is rendered in a document.
 */
export interface RunCliArgs {
  /** Full CLI argument vector, e.g. `["status"]` or `["checkpoint", "list"]`. */
  args?: string[];
}

export interface RunCliResult {
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface CliChoice {
  label: string;
  detail: string;
  args?: string[];
  custom?: boolean;
}

/** Common, safe subcommands offered in the picker (custom entry covers the rest). */
const COMMON_COMMANDS: CliChoice[] = [
  { label: "status", args: ["status"], detail: "Show repository-local GraphForge state" },
  { label: "sync --check", args: ["sync", "--check"], detail: "Compare declared definitions vs source digests (no writes)" },
  { label: "config validate", args: ["config", "validate"], detail: "Validate graphforge.yaml" },
  { label: "config resolve", args: ["config", "resolve"], detail: "Emit resolved, secret-free configuration" },
  { label: "checkpoint list", args: ["checkpoint", "list"], detail: "List active checkpoints" },
  { label: "skills status", args: ["skills", "status"], detail: "Inspect managed project-skill provenance" },
  { label: "$(pencil) Custom…", detail: "Type a full CLI argument line", custom: true },
];

export function registerRunCli(
  context: vscode.ExtensionContext,
  // session is unused today but kept for signature parity with other registrars.
  _session: unknown,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("graphforge.runCli", (args?: RunCliArgs) => runCli(args)),
  );
}

/** Split a typed CLI line into an argv, respecting simple double-quoted spans. */
function parseArgLine(line: string): string[] {
  const matches = line.match(/"[^"]*"|\S+/g) ?? [];
  return matches.map((token) => token.replace(/^"|"$/g, ""));
}

async function runCli(args?: RunCliArgs): Promise<CommandOutcome<RunCliResult>> {
  if (!isCliAvailable()) {
    const message =
      "The GraphForge CLI needs the Node binding (@curatelabs/graphforge) — it isn't loaded.";
    void vscode.window
      .showWarningMessage(`GraphForge: ${message}`, RECOVERY_SETUP_NATIVE)
      .then((choice) =>
        choice === RECOVERY_SETUP_NATIVE
          ? vscode.commands.executeCommand("graphforge.setupNativeBinding")
          : undefined,
      );
    return {
      error: message,
      code: "CLI_UNAVAILABLE",
      nextAction: 'Run "GraphForge: Setup Native Binding" (graphforge.setupNativeBinding).',
    };
  }

  let cliArgs = args?.args;
  if (!cliArgs || cliArgs.length === 0) {
    const picked = await vscode.window.showQuickPick(COMMON_COMMANDS, {
      title: "GraphForge: Run CLI…",
      placeHolder: "Choose a CLI command",
    });
    if (!picked) {
      return { cancelled: true };
    }
    if (picked.custom) {
      const typed = await vscode.window.showInputBox({
        title: "GraphForge: Run CLI…",
        prompt: "CLI arguments (e.g. checkpoint show my-checkpoint)",
        placeHolder: "status",
      });
      if (typed === undefined) {
        return { cancelled: true };
      }
      cliArgs = parseArgLine(typed);
    } else {
      cliArgs = picked.args ?? [];
    }
  }
  if (!cliArgs.length) {
    return { cancelled: true };
  }

  try {
    const result = runGraphForgeCli(cliArgs);
    const doc = await vscode.workspace.openTextDocument({
      content:
        `$ graphforge ${cliArgs.join(" ")}\n` +
        `# exit ${result.exitCode}\n\n` +
        (result.stdout || "(no stdout)\n") +
        (result.stderr ? `\n--- stderr ---\n${result.stderr}` : ""),
      language: "text",
    });
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true,
    });
    if (result.exitCode !== 0) {
      void vscode.window.showWarningMessage(
        `GraphForge: CLI "${cliArgs.join(" ")}" exited ${result.exitCode}.`,
      );
    }
    return { args: cliArgs, ...result };
  } catch (err) {
    return reportEngineError("Run CLI failed", err);
  }
}
