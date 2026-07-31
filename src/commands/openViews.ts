import * as path from "node:path";
import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import { isGraphForgeProject } from "../session/projectDetector";
import { OntologyPanel } from "../webview/ontologyPanel";
import { ResultGraphPanel } from "../webview/resultGraphPanel";

export function registerOpenViews(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
  refreshTrees: () => void,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "graphforge.openProject",
      async (pathArg?: string) => {
        let rootPath = typeof pathArg === "string" ? pathArg : undefined;
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
        } catch (err) {
          void vscode.window.showErrorMessage(
            err instanceof Error ? err.message : String(err),
          );
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
        mode: session.ontologyMode(),
        ontology: session.workspaceOntology(),
        projectName: session.project?.name,
      });
    }),

    vscode.commands.registerCommand("graphforge.showResultGraph", () => {
      const payload = session.toGraphPayload(
        { columns: [], rows: [], rowCount: 0 },
        "Demo graph",
      );
      ResultGraphPanel.show(context.extensionUri, payload);
    }),

    vscode.commands.registerCommand("graphforge.showCapabilities", async () => {
      try {
        await session.ensureProject();
      } catch (err) {
        void vscode.window.showErrorMessage(
          err instanceof Error ? err.message : String(err),
        );
        return;
      }
      const caps = session.capabilities();
      const lines = [
        `Project: ${session.project?.rootPath}`,
        `Generation: ${caps.generationUuid ?? "(none)"}`,
        `Ontology mode: ${session.ontologyMode()}`,
        `Binding: ${session.bindingAvailable ? "ok" : session.bindingError}`,
        "",
        "Capabilities / participants:",
        ...(caps.capabilities.length
          ? caps.capabilities.map((c) => `  - ${c}`)
          : ["  (none listed in manifest)"]),
      ];
      const doc = await vscode.workspace.openTextDocument({
        content: lines.join("\n"),
        language: "markdown",
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),

    vscode.commands.registerCommand("graphforge.loadOntology", async () => {
      try {
        await session.ensureProject();
      } catch (err) {
        void vscode.window.showErrorMessage(
          err instanceof Error ? err.message : String(err),
        );
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
        session.loadOntology(file);
        refreshTrees();
        OntologyPanel.show(context.extensionUri, {
          mode: session.ontologyMode(),
          ontology: session.workspaceOntology(),
          projectName: session.project?.name,
        });
        void vscode.window.showInformationMessage(`Loaded ontology: ${file}`);
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Load ontology failed: ${err instanceof Error ? err.message : String(err)}`,
        );
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
      const mode = session.ontologyMode();
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
