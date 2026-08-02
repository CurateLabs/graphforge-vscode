import * as path from "node:path";
import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import { UnsupportedByBindingError } from "../session/graphForgeSession";
import { isGraphForgeProject } from "../session/projectDetector";
import type { QueryResult } from "../session/types";
import { OntologyPanel } from "../webview/ontologyPanel";
import { SettingsPanel } from "../webview/settingsPanel";
import {
  GetStartedViewProvider,
  revealGetStarted,
  revealGetStartedPage,
  type GetStartedPage,
} from "../views/getStartedView";
import { ensureProjectOrRecover, presentError, reportEngineError } from "./shared";

export function registerOpenViews(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
  refreshTrees: () => void,
): void {
  const showGetStartedPage = async (page: GetStartedPage) => {
    const provider = GetStartedViewProvider.instance;
    if (provider) {
      await revealGetStartedPage(provider, page);
    } else {
      await vscode.commands.executeCommand("workbench.view.extension.graphforge");
      await vscode.commands.executeCommand("graphforge.getStarted.focus");
    }
  };
  const projectPathFromArg = (
    arg?: string | vscode.Uri | { path?: string | vscode.Uri },
  ): string | undefined => {
    if (typeof arg === "string") return arg.trim() || undefined;
    if (arg && typeof arg === "object" && "fsPath" in arg) return arg.fsPath;
    const value = arg?.path;
    return typeof value === "string" ? value.trim() || undefined : value?.fsPath;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "graphforge.openProject",
      async (pathArg?: string | vscode.Uri | { path?: string | vscode.Uri }) => {
        let rootPath = projectPathFromArg(pathArg);
        if (!rootPath) {
          const uri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: "Open GraphForge Project",
          });
          rootPath = uri?.[0]?.fsPath;
        }
        if (!rootPath) {
          return;
        }
        if (!isGraphForgeProject(rootPath)) {
          void vscode.window.showErrorMessage(
            "Selected folder is not a GraphForge project (FORMAT must be exactly graphforge-project/v1\\n).",
          );
          return;
        }
        try {
          await session.openProject(rootPath);
          refreshTrees();
          void vscode.window.showInformationMessage(
            `Opened GraphForge project: ${rootPath}`,
          );
          return { path: rootPath, project: session.project };
        } catch (err) {
          return reportEngineError("open project failed", err);
        }
      },
    ),

    vscode.commands.registerCommand("graphforge.refreshExplorer", () => {
      refreshTrees();
    }),

    vscode.commands.registerCommand("graphforge.showOntology", async () => {
      try {
        await session.ensureProject();
      } catch {
        // still show empty viewer
      }
      OntologyPanel.show(context.extensionUri, {
        mode: await session.ontologyMode(),
        ontology: session.workspaceOntology(),
        projectName: session.project?.name,
      });
    }),

    vscode.commands.registerCommand("graphforge.openSettings", () => {
      SettingsPanel.show(context.extensionUri);
    }),

    vscode.commands.registerCommand("graphforge.getStarted", async () => {
      const provider = GetStartedViewProvider.instance;
      if (provider) {
        await revealGetStarted(provider);
      } else {
        await vscode.commands.executeCommand("workbench.view.extension.graphforge");
        await vscode.commands.executeCommand("graphforge.getStarted.focus");
      }
    }),

    vscode.commands.registerCommand("graphforge.getStarted.showHub", () =>
      showGetStartedPage("hub"),
    ),

    vscode.commands.registerCommand("graphforge.getStarted.showQuery", () =>
      showGetStartedPage("query"),
    ),

    vscode.commands.registerCommand("graphforge.getStarted.showVisualize", () =>
      showGetStartedPage("visualize"),
    ),

    vscode.commands.registerCommand("graphforge.chooseExperienceMode", async () => {
      const provider = GetStartedViewProvider.instance;
      if (provider) {
        await revealGetStarted(provider);
        provider.showWelcome();
      } else {
        await vscode.commands.executeCommand("workbench.view.extension.graphforge");
        await vscode.commands.executeCommand("graphforge.getStarted.focus");
      }
    }),

    vscode.commands.registerCommand("graphforge.statusBarClick", async () => {
      if (session.project && session.activeRuntime) {
        await vscode.commands.executeCommand("graphforge.showCapabilities");
        return;
      }
      await vscode.commands.executeCommand("graphforge.getStarted");
    }),

    vscode.commands.registerCommand("graphforge.showCapabilities", async () => {
      const recovery = await ensureProjectOrRecover(session);
      if (recovery) {
        return;
      }

      let liveCaps: QueryResult | undefined;
      try {
        liveCaps = await session.liveCapabilities();
      } catch (err) {
        if (!(err instanceof UnsupportedByBindingError)) {
          void vscode.window.showWarningMessage(
            `GraphForge: could not fetch live capabilities (${presentError(err).message}), falling back to manifest.`,
          );
        }
        liveCaps = undefined;
      }

      const caps = session.capabilities();
      const runtime = session.activeRuntime ?? "none";
      const lines = [
        `Project: ${session.project?.rootPath}`,
        `Generation: ${caps.generationUuid ?? "(none)"}`,
        `Ontology mode: ${await session.ontologyMode()}`,
        `Write mode: ${session.writeMode}`,
        `Runtime: ${runtime}`,
        `Node binding: ${session.bindingAvailable ? "ok" : session.bindingError}`,
        "",
        "Manifest capabilities / participants:",
        ...(caps.capabilities.length
          ? caps.capabilities.map((c) => `  - ${c}`)
          : ["  (none listed in manifest)"]),
      ];
      if (liveCaps) {
        lines.push(
          "",
          "Live capabilities (from engine):",
          ...(liveCaps.rows.length
            ? liveCaps.rows.map(
                (row) => `  - ${row.capability_id} (v${row.capability_version})`,
              )
            : ["  (none enabled by engine)"]),
        );
      }
      const doc = await vscode.workspace.openTextDocument({
        content: lines.join("\n"),
        language: "markdown",
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),

    vscode.commands.registerCommand("graphforge.loadOntology", async () => {
      const recovery = await ensureProjectOrRecover(session);
      if (recovery) {
        return;
      }
      const uri = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { Ontology: ["yaml", "yml", "json"] },
        openLabel: "Load Ontology",
      });
      const file = uri?.[0]?.fsPath;
      if (!file) {
        return;
      }
      try {
        await session.loadOntology(file);
        refreshTrees();
        OntologyPanel.show(context.extensionUri, {
          mode: await session.ontologyMode(),
          ontology: session.workspaceOntology(),
          projectName: session.project?.name,
        });
        void vscode.window.showInformationMessage(`Loaded ontology: ${file}`);
      } catch (err) {
        reportEngineError("load ontology failed", err);
      }
    }),

    vscode.commands.registerCommand("graphforge.openOntologyFile", async () => {
      const project = session.project;
      const generationUuid = project?.current?.generation_uuid;
      if (!project || !generationUuid) {
        const choice = await vscode.window.showInformationMessage(
          "No committed ontology file for this project yet.",
          "Load Ontology…",
        );
        if (choice === "Load Ontology…") {
          await vscode.commands.executeCommand("graphforge.loadOntology");
        }
        return;
      }
      const ontologyPath = path.join(
        project.rootPath,
        "generations",
        generationUuid,
        "participants",
        "workspace",
        "ontology.json",
      );
      try {
        const doc = await vscode.workspace.openTextDocument(ontologyPath);
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch {
        const choice = await vscode.window.showInformationMessage(
          "No committed ontology.json in this generation's workspace participant yet.",
          "Load Ontology…",
        );
        if (choice === "Load Ontology…") {
          await vscode.commands.executeCommand("graphforge.loadOntology");
        }
      }
    }),

    vscode.commands.registerCommand("graphforge.explainOntologyMode", async () => {
      const mode = await session.ontologyMode();
      const doc = await vscode.workspace.openTextDocument({
        content: [
          `# GraphForge Ontology Modes`,
          "",
          `Current project mode: **${mode}**`,
          "",
          "GraphForge's ontology is progressive — you are never required to define",
          "a schema up front. Modes tighten enforcement as a project matures:",
          "",
          "- **exploratory** — no ontology required. Any labels/relationship types",
          "  are accepted as-is. This is the default for new/empty projects.",
          "- **advisory** — a committed ontology exists and is used for display",
          "  and hints (e.g. abstract/parent types), but writes outside it are",
          "  still allowed.",
          "- **strict** — writes that do not conform to the committed ontology",
          "  are rejected by the engine.",
          "",
          "Use **GraphForge: Load Ontology…** to commit an ontology document and",
          "move a project from exploratory towards advisory/strict.",
        ].join("\n"),
        language: "markdown",
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
  );
}
