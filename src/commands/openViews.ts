import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import { UnsupportedByBindingError } from "../session/graphForgeSession";
import { isGraphForgeProject } from "../session/projectDetector";
import type { QueryResult } from "../session/types";
import { OntologyPanel } from "../webview/ontologyPanel";
import { ResultGraphPanel } from "../webview/resultGraphPanel";
import { errorMessage } from "./shared";

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

      let liveCaps: QueryResult | undefined;
      try {
        liveCaps = await session.liveCapabilities();
      } catch (err) {
        if (!(err instanceof UnsupportedByBindingError)) {
          void vscode.window.showWarningMessage(
            `GraphForge: could not fetch live capabilities (${errorMessage(err)}), falling back to manifest.`,
          );
        }
        liveCaps = undefined;
      }

      const caps = session.capabilities();
      const lines = [
        `Project: ${session.project?.rootPath}`,
        `Generation: ${caps.generationUuid ?? "(none)"}`,
        `Ontology mode: ${session.ontologyMode()}`,
        `Write mode: ${session.writeMode}`,
        `Binding: ${session.bindingAvailable ? "ok" : session.bindingError}`,
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
