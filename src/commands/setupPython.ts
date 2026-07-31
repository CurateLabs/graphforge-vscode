import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import { collectPythonCandidates, resetPythonCache, resolvePythonRuntime } from "../session/pythonLoader";

/**
 * Registers `GraphForge: Setup Python Binding` (#12). One QuickPick, at most
 * three choices, matching the #1/#2 palette-first doctrine: no cascading
 * menus, explicit consent before any network install.
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
  action: "use-detected" | "select" | "pip-install";
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
    label: "$(cloud-download) pip install graphforge",
    detail: status.available
      ? `Already importable (${status.graphforgeVersion ?? "version unknown"}) — reinstall/upgrade`
      : "Runs `<interpreter> -m pip install graphforge` in a terminal after you confirm",
    action: "pip-install",
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
    case "pip-install": {
      const interpreterPath = best?.interpreterPath;
      if (!interpreterPath) {
        void vscode.window.showWarningMessage(
          "GraphForge: no Python interpreter detected yet — run Setup Python Binding again and choose Select interpreter first.",
        );
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Run "${interpreterPath} -m pip install graphforge"? This makes a network request.`,
        { modal: true },
        "Install",
      );
      if (confirm !== "Install") {
        return;
      }
      const terminal = vscode.window.createTerminal("GraphForge Setup (Python)");
      terminal.show();
      terminal.sendText(`"${interpreterPath}" -m pip install graphforge`);
      void vscode.window.showInformationMessage(
        "GraphForge: running pip install graphforge — rerun Check Environment once it finishes.",
      );
      break;
    }
  }
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
      `GraphForge: interpreter set (${interpreterPath}) but graphforge is not importable yet — ${status.error ?? "unknown error"}. Try pip install graphforge.`,
    );
  }
}
