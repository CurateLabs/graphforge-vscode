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

    vscode.commands.registerCommand("graphforge.showResultGraph", async () => {
      // Refresh from the last query/verb result when there is one; an
      // explicit demo graph only when nothing has run yet in this session.
      const payload = await session.lastGraphPayload();
      ResultGraphPanel.show(context.extensionUri, payload);
    }),

    vscode.commands.registerCommand("graphforge.showResultGraphAdvanced", async () => {
      const current = session.getBeliefPolicy();
      const enabledPick = await vscode.window.showQuickPick(
        [
          { label: "Enabled", picked: current.enabled, value: true },
          { label: "Disabled (always class-only)", picked: !current.enabled, value: false },
        ],
        { title: "GraphForge: Result Graph — resolve epistemic status from ledger?" },
      );
      if (!enabledPick) {
        return;
      }
      const maxNodesRaw = await vscode.window.showInputBox({
        title: "GraphForge: Result Graph — max nodes to resolve",
        prompt: "Bounds belief/status lookups per render (higher = slower on large graphs)",
        value: String(current.maxNodes),
        validateInput: (value) =>
          Number.isFinite(Number(value)) && Number(value) > 0
            ? undefined
            : "Enter a positive number",
      });
      if (maxNodesRaw === undefined) {
        return;
      }
      session.setBeliefPolicy({
        enabled: enabledPick.value,
        maxNodes: Math.max(1, Math.trunc(Number(maxNodesRaw)) || current.maxNodes),
      });
      const payload = await session.lastGraphPayload();
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
  );
}
