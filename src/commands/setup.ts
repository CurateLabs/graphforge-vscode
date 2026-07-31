import * as fs from "node:fs";
import * as vscode from "vscode";
import {
  EnvironmentReport,
  computeNextAction,
  formatSummaryLines,
} from "../session/environmentReport";
import type { GraphForgeSession } from "../session/graphForgeSession";
import { detectSiblingBindingPath, resetNativeCache } from "../session/nativeLoader";
import { classifyInitTarget } from "../session/projectDetector";
import { engineErrorCode, errorMessage } from "./shared";

/**
 * Registers Setup UX commands (#2, extended by #12 for Python): `Check
 * Environment`, `Setup Native Binding`, and `Initialize Project Here`. Each
 * is a single palette command with at most one QuickPick — no cascading
 * menus. `Setup Python Binding` is registered separately (`setupPython.ts`)
 * but shares this module's environment report.
 */
export function registerSetup(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
  refreshTrees: () => void,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("graphforge.checkEnvironment", async () => {
      const report = await buildEnvironmentReport(session);
      void vscode.window.showInformationMessage(formatSummaryLines(report).join("\n"));

      const doc = await vscode.workspace.openTextDocument({
        content: JSON.stringify(report, null, 2),
        language: "json",
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),

    vscode.commands.registerCommand("graphforge.setupNativeBinding", async () => {
      await runSetupNativeBinding(session);
    }),

    vscode.commands.registerCommand("graphforge.initializeProjectHere", async () => {
      await runInitializeProjectHere(session, refreshTrees);
    }),
  );
}

/**
 * Agent- and human-facing dual-runtime status (#12): Node binding, Python
 * interpreter + `graphforge` import, active runtime, and a single next step.
 */
export async function buildEnvironmentReport(session: GraphForgeSession): Promise<EnvironmentReport> {
  const snapshot = await session.environmentSnapshot();
  const project = session.project;
  const projectOpen = Boolean(project);
  const active = snapshot.active ?? "none";
  return {
    runtime: {
      preference: snapshot.preference,
      active,
      projectKind: snapshot.projectKind,
    },
    nodeBinding: {
      available: snapshot.node.available,
      error: snapshot.node.error,
    },
    python: snapshot.python,
    project: {
      open: projectOpen,
      path: project?.rootPath,
      name: project?.name,
      ontologyMode: projectOpen ? await session.ontologyMode() : undefined,
    },
    nextAction: computeNextAction(snapshot.node.available, snapshot.python.available, projectOpen, active),
    timestamp: new Date().toISOString(),
  };
}

type BindingChoice = {
  label: string;
  detail?: string;
  action: "link" | "path" | "install";
};

async function runSetupNativeBinding(session: GraphForgeSession): Promise<void> {
  const sibling = detectSiblingBindingPath();
  const choices: BindingChoice[] = [];
  if (sibling) {
    choices.push({
      label: "$(link) Link sibling engine build",
      detail: sibling,
      action: "link",
    });
  }
  choices.push({
    label: "$(folder-opened) Set nativeModulePath…",
    detail: "Browse for a built @graphforge/node folder (directory containing index.js)",
    action: "path",
  });
  choices.push({
    label: "$(cloud-download) Install @graphforge/node from npm",
    detail: "Runs npm install in a terminal (only when published)",
    action: "install",
  });

  const picked = await vscode.window.showQuickPick(choices, {
    title: "GraphForge: Setup Native Binding",
    placeHolder: "Choose how to make @graphforge/node available",
  });
  if (!picked) {
    return;
  }

  switch (picked.action) {
    case "link":
      if (sibling) {
        await applyNativeModulePath(session, sibling);
      }
      break;
    case "path": {
      const uri = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Select @graphforge/node folder",
      });
      const selected = uri?.[0]?.fsPath;
      if (selected) {
        await applyNativeModulePath(session, selected);
      }
      break;
    }
    case "install": {
      const terminal = vscode.window.createTerminal("GraphForge Setup");
      terminal.show();
      terminal.sendText("npm install @graphforge/node");
      void vscode.window.showInformationMessage(
        "GraphForge: running npm install @graphforge/node — rerun Check Environment once it finishes.",
      );
      break;
    }
  }
}

async function applyNativeModulePath(
  session: GraphForgeSession,
  modulePath: string,
): Promise<void> {
  await vscode.workspace
    .getConfiguration("graphforge")
    .update("nativeModulePath", modulePath, vscode.ConfigurationTarget.Global);
  resetNativeCache();
  session.notifyChanged();

  if (session.bindingAvailable) {
    void vscode.window.showInformationMessage(
      `GraphForge: native binding linked (${modulePath}). Run Query is now available.`,
    );
  } else {
    void vscode.window.showWarningMessage(
      `GraphForge: still unavailable after setting nativeModulePath — ${session.bindingError}`,
    );
  }
}

async function runInitializeProjectHere(
  session: GraphForgeSession,
  refreshTrees: () => void,
): Promise<void> {
  if (!(await session.hasUsableRuntime())) {
    const action = await vscode.window.showErrorMessage(
      "GraphForge: no usable runtime (Node binding and Python graphforge both unavailable).",
      "Setup Native Binding",
      "Setup Python Binding",
    );
    if (action === "Setup Native Binding") {
      await vscode.commands.executeCommand("graphforge.setupNativeBinding");
    } else if (action === "Setup Python Binding") {
      await vscode.commands.executeCommand("graphforge.setupPythonBinding");
    }
    return;
  }

  const rootPath = await pickInitTarget();
  if (!rootPath) {
    return;
  }

  const safety = classifyInitTarget(rootPath);
  if (safety.kind === "already-project") {
    const openIt = await vscode.window.showInformationMessage(
      `${rootPath} is already a GraphForge project.`,
      "Open Project",
    );
    if (openIt) {
      await vscode.commands.executeCommand("graphforge.openProject", rootPath);
    }
    return;
  }

  if (safety.kind === "missing") {
    const create = await vscode.window.showWarningMessage(
      `Folder does not exist: ${rootPath}.`,
      "Create Folder",
    );
    if (!create) {
      return;
    }
    try {
      fs.mkdirSync(rootPath, { recursive: true });
    } catch (err) {
      void vscode.window.showErrorMessage(
        `GraphForge: could not create folder — ${errorMessage(err)}`,
      );
      return;
    }
  } else if (safety.kind === "non-empty") {
    const proceed = await vscode.window.showWarningMessage(
      `${rootPath} is not empty (${safety.entries.length} entr${
        safety.entries.length === 1 ? "y" : "ies"
      }). GraphForge only initializes empty or resumable-uninitialized directories and will fail closed otherwise. Continue?`,
      "Continue",
    );
    if (!proceed) {
      return;
    }
  } else {
    const confirm = await vscode.window.showInformationMessage(
      `Initialize a new GraphForge project in ${rootPath}?`,
      "Initialize",
    );
    if (!confirm) {
      return;
    }
  }

  try {
    const project = await session.initializeProject(rootPath);
    refreshTrees();
    void vscode.window.showInformationMessage(
      `GraphForge project initialized: ${project.rootPath}`,
    );
  } catch (err) {
    const code = engineErrorCode(err);
    void vscode.window.showErrorMessage(
      `GraphForge: initialize failed${code ? ` [${code}]` : ""} — ${errorMessage(err)}`,
    );
  }
}

async function pickInitTarget(): Promise<string | undefined> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  type TargetChoice = { label: string; detail?: string; action: "workspace" | "browse" };
  const choices: TargetChoice[] = [];
  if (workspaceRoot) {
    choices.push({
      label: "$(root-folder) Use current workspace folder",
      detail: workspaceRoot,
      action: "workspace",
    });
  }
  choices.push({ label: "$(folder-opened) Choose folder…", action: "browse" });

  const picked = await vscode.window.showQuickPick(choices, {
    title: "GraphForge: Initialize Project Here",
    placeHolder: "Where should the new project live?",
  });
  if (!picked) {
    return undefined;
  }
  if (picked.action === "workspace") {
    return workspaceRoot;
  }
  const uri = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Initialize Project Here",
  });
  return uri?.[0]?.fsPath;
}
