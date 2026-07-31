import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import { collectPythonCandidates, resetPythonCache, resolvePythonRuntime } from "../session/pythonLoader";

const UV_INSTALL_DOCS_URL = "https://docs.astral.sh/uv/getting-started/installation/";

/**
 * Registers `GraphForge: Setup Python Binding` (#12, updated per product
 * feedback to be uv-only — see #12 decisions comment). One QuickPick, at
 * most three choices, matching the #1/#2 palette-first doctrine: no
 * cascading menus, explicit consent before any network install.
 *
 * Package manager policy: **uv only, never pip.** If `uv` isn't installed,
 * the install choice tells the user to install uv first and stops — it does
 * not fall back to `pip install`.
 */
export function registerSetupPython(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("graphforge.setupPythonBinding", async () => {
      await runSetupPythonBinding(session);
    }),
  );
}

type PythonChoice = {
  label: string;
  detail?: string;
  action: "use-detected" | "select" | "uv-install";
};

async function runSetupPythonBinding(session: GraphForgeSession): Promise<void> {
  const candidates = await collectPythonCandidates();
  const status = await resolvePythonRuntime();
  const choices: PythonChoice[] = [];

  const best = candidates[0];
  if (best) {
    choices.push({
      label: `$(check) Use detected interpreter (${best.source})`,
      detail: best.interpreterPath,
      action: "use-detected",
    });
  }
  choices.push({
    label: "$(folder-opened) Select interpreter…",
    detail: "Browse for a python / python3 executable (sets graphforge.pythonInterpreterPath)",
    action: "select",
  });
  choices.push({
    label: `$(cloud-download) ${describeUvInstallCommand()}`,
    detail: status.available
      ? `Already importable (${status.graphforgeVersion ?? "version unknown"}) — reinstall/upgrade via uv`
      : "Installs graphforge with uv in a terminal after you confirm (requires uv — never falls back to pip)",
    action: "uv-install",
  });

  const picked = await vscode.window.showQuickPick(choices, {
    title: "GraphForge: Setup Python Binding",
    placeHolder: "Choose how to make Python `graphforge` available",
  });
  if (!picked) {
    return;
  }

  switch (picked.action) {
    case "use-detected":
      if (best) {
        await applyPythonInterpreterPath(session, best.interpreterPath);
      }
      break;
    case "select": {
      const uri = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: "Select Python interpreter",
        filters: process.platform === "win32" ? { Executable: ["exe"] } : undefined,
      });
      const selected = uri?.[0]?.fsPath;
      if (selected) {
        await applyPythonInterpreterPath(session, selected);
      }
      break;
    }
    case "uv-install":
      await runUvInstall(best?.interpreterPath);
      break;
  }
}

/**
 * `uv add graphforge` when the workspace looks like a uv-managed project
 * (`pyproject.toml` / `uv.lock` present — see `projectKind.ts`'s stronger
 * Python markers), otherwise `uv pip install --python <interpreter>
 * graphforge` targeting the resolved interpreter directly. Never `pip
 * install`: if `uv` itself isn't on PATH, this tells the user to install uv
 * first instead of falling back.
 */
async function runUvInstall(interpreterPath: string | undefined): Promise<void> {
  if (!(await isUvAvailable())) {
    const action = await vscode.window.showErrorMessage(
      "GraphForge: uv is not installed. Install uv first — GraphForge only installs Python packages with uv, never pip.",
      "Open uv install docs",
    );
    if (action) {
      void vscode.env.openExternal(vscode.Uri.parse(UV_INSTALL_DOCS_URL));
    }
    return;
  }

  const command = uvInstallCommand(interpreterPath);
  if (!command) {
    void vscode.window.showWarningMessage(
      "GraphForge: no Python interpreter detected yet — run Setup Python Binding again and choose Select interpreter first.",
    );
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Run "${command}"? This makes a network request.`,
    { modal: true },
    "Install",
  );
  if (confirm !== "Install") {
    return;
  }
  const terminal = vscode.window.createTerminal("GraphForge Setup (Python)");
  terminal.show();
  terminal.sendText(command);
  void vscode.window.showInformationMessage(
    `GraphForge: running ${command} — rerun Check Environment once it finishes.`,
  );
}

/** Human-facing label for the install QuickPick choice, before we know if `uv` is even installed. */
function describeUvInstallCommand(): string {
  return workspaceLooksLikeUvProject() ? "uv add graphforge" : "uv pip install graphforge";
}

function uvInstallCommand(interpreterPath: string | undefined): string | undefined {
  if (workspaceLooksLikeUvProject()) {
    return "uv add graphforge";
  }
  if (!interpreterPath) {
    return undefined;
  }
  return `uv pip install --python "${interpreterPath}" graphforge`;
}

/** `pyproject.toml` or `uv.lock` at the workspace root — a real uv-managed project, not just a stray script. */
function workspaceLooksLikeUvProject(): boolean {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    return false;
  }
  return fs.existsSync(path.join(root, "pyproject.toml")) || fs.existsSync(path.join(root, "uv.lock"));
}

function isUvAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("uv", ["--version"], { timeout: 5000 }, (err) => resolve(!err));
  });
}

async function applyPythonInterpreterPath(
  session: GraphForgeSession,
  interpreterPath: string,
): Promise<void> {
  await vscode.workspace
    .getConfiguration("graphforge")
    .update("pythonInterpreterPath", interpreterPath, vscode.ConfigurationTarget.Workspace);
  resetPythonCache();
  session.notifyChanged();

  const status = await resolvePythonRuntime();
  if (status.available) {
    void vscode.window.showInformationMessage(
      `GraphForge: Python runtime ready (${interpreterPath}, graphforge ${status.graphforgeVersion ?? "?"}). Set graphforge.runtime to "python" or "auto" to use it.`,
    );
  } else {
    void vscode.window.showWarningMessage(
      `GraphForge: interpreter set (${interpreterPath}) but graphforge is not importable yet — ${status.error ?? "unknown error"}. Try "${describeUvInstallCommand()}".`,
    );
  }
}
