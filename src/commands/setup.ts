import * as fs from "node:fs";
import * as vscode from "vscode";
import { defaultsForExperienceMode, resolveExperienceMode } from "../session/experienceMode";
import {
  EnvironmentReport,
  computeNextAction,
  formatSummaryLines,
} from "../session/environmentReport";
import type { GraphForgeSession } from "../session/graphForgeSession";
import { detectSiblingBindingPath, resetNativeCache } from "../session/nativeLoader";
import { classifyInitTarget } from "../session/projectDetector";
import { summarizeNodeUnavailable } from "../session/runtimeSelection";
import { npmEngineSpec } from "../session/engineVersion";
import { isCliAvailable, runGraphForgeCli } from "../session/graphforgeCli";
import { pickEngineVersion } from "./engineVersionPick";
import {
  errorMessage,
  logErrorDetail,
  RECOVERY_SETUP_NATIVE,
  RECOVERY_SETUP_PYTHON,
  reportEngineError,
} from "./shared";

/**
 * Registers Setup UX commands (#2, extended by #12 for Python): `Check
 * Environment`, `Setup Native Binding`, and `Initialize Project Here`. Each
 * is a single palette command with at most one QuickPick — no cascading
 * menus. `Setup Python Binding` is registered separately (`setupPython.ts`)
 * but shares this module's environment report.
 */
/** Optional args for `graphforge.checkEnvironment`. */
export interface CheckEnvironmentArgs {
  /**
   * Skip the info-message toast and the opened JSON document. The command
   * always returns the `EnvironmentReport` regardless of this flag, so a
   * coding agent calling `executeCommand("graphforge.checkEnvironment", {
   * silent: true })` gets structured data without any editor UI side effects.
   */
  silent?: boolean;
}

const COPY_REPORT = "Copy Report";

/** Put the curated environment JSON on the clipboard with a confirmation toast (#32). */
async function copyReportToClipboard(report: EnvironmentReport): Promise<void> {
  await vscode.env.clipboard.writeText(JSON.stringify(report, null, 2));
  void vscode.window.showInformationMessage(
    "GraphForge: environment report copied to clipboard.",
  );
}

export function registerSetup(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
  refreshTrees: () => void,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "graphforge.checkEnvironment",
      async (args?: CheckEnvironmentArgs): Promise<EnvironmentReport> => {
        const report = await buildEnvironmentReport(session);
        if (!args?.silent) {
          // Fire-and-forget so headless/agent runs never hang on the toast;
          // the Copy Report button closes the paste-into-a-bug-report loop
          // without a second probe (#32).
          void vscode.window
            .showInformationMessage(formatSummaryLines(report).join("\n"), COPY_REPORT)
            .then((choice) =>
              choice === COPY_REPORT ? copyReportToClipboard(report) : undefined,
            );

          const doc = await vscode.workspace.openTextDocument({
            content: JSON.stringify(report, null, 2),
            language: "json",
          });
          await vscode.window.showTextDocument(doc, { preview: true });
        }
        return report;
      },
    ),

    // #32: always-available palette twin of Check Environment's Copy Report
    // button. Same probe path (`buildEnvironmentReport`), no editor UI side
    // effects, and it returns the report so agents get structured data too.
    vscode.commands.registerCommand(
      "graphforge.copyEnvironmentReport",
      async (): Promise<EnvironmentReport> => {
        const report = await buildEnvironmentReport(session);
        await copyReportToClipboard(report);
        return report;
      },
    ),

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
    detail: "Browse for a built @curatelabs/graphforge folder (directory containing index.js)",
    action: "path",
  });
  choices.push({
    label: "$(cloud-download) Install @curatelabs/graphforge from npm",
    detail: "Runs npm install in a terminal",
    action: "install",
  });

  const picked = await vscode.window.showQuickPick(choices, {
    title: "GraphForge: Setup Native Binding",
    placeHolder: "Choose how to make @curatelabs/graphforge available",
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
        openLabel: "Select @curatelabs/graphforge folder",
      });
      const selected = uri?.[0]?.fsPath;
      if (selected) {
        await applyNativeModulePath(session, selected);
      }
      break;
    }
    case "install": {
      const version = await pickEngineVersion("npm");
      if (version === undefined) {
        return;
      }
      const spec = npmEngineSpec(version);
      const terminal = vscode.window.createTerminal("GraphForge Setup");
      terminal.show();
      terminal.sendText(`npm install ${spec}`);
      void vscode.window.showInformationMessage(
        `GraphForge: running npm install ${spec} — rerun Check Environment once it finishes.`,
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
    // Curated summary (#27/#28): the raw loader diagnostics stay in Check
    // Environment's JSON report, not in this toast.
    void vscode.window.showWarningMessage(
      `GraphForge: still unavailable after setting nativeModulePath — ` +
        `${summarizeNodeUnavailable(session.bindingError)}. Run "GraphForge: Check Environment" for full diagnostics.`,
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
      RECOVERY_SETUP_NATIVE,
      RECOVERY_SETUP_PYTHON,
    );
    if (action === RECOVERY_SETUP_NATIVE) {
      await vscode.commands.executeCommand("graphforge.setupNativeBinding");
    } else if (action === RECOVERY_SETUP_PYTHON) {
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
    const mode = resolveExperienceMode(
      vscode.workspace.getConfiguration("graphforge").get("experienceMode"),
    );
    if (defaultsForExperienceMode(mode).confirmBeforeInitialize) {
      const confirm = await vscode.window.showInformationMessage(
        `Initialize a new GraphForge project in ${rootPath}?`,
        "Initialize",
      );
      if (!confirm) {
        return;
      }
    }
  }

  try {
    // Prefer engine-owned scaffolding via the CLI (graphforge.yaml + packaged
    // project skills) when the Node binding is available. Fails soft: a
    // non-zero exit is logged and we fall through to the binding's own
    // initialize path rather than dead-ending.
    if (isCliAvailable()) {
      const cli = runGraphForgeCli(["init", "--project", rootPath]);
      if (cli.exitCode !== 0) {
        logErrorDetail(
          "gf init (non-zero exit) — falling back to binding initialize",
          new Error(cli.stderr || `gf init exited ${cli.exitCode}`),
        );
      }
    }
    const project = await session.initializeProject(rootPath);
    refreshTrees();
    void vscode.window.showInformationMessage(
      `GraphForge project initialized: ${project.rootPath}`,
    );
  } catch (err) {
    reportEngineError("initialize failed", err);
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
