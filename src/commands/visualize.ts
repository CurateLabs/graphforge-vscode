import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import { createResultGraphSpec } from "../session/visualizationRegistry";
import { XygVisualizationPanel } from "../webview/xygPanel";
import { reportEngineError } from "./shared";

export function registerVisualizationCommands(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "graphforge.showResultGraph",
      async (args?: { title?: string; waitForReady?: boolean }) => {
        try {
          const result = session.getLastResult();
          if (!result)
            throw new Error(
              "Run a query returning canonical nodes and relationships first.",
            );
          const spec = createResultGraphSpec({
            name: args?.title ?? "Result Graph",
            result: "results/query-result.json",
          });
          const shown = XygVisualizationPanel.show(
            context.extensionUri,
            spec,
            result,
            session.project!.rootPath,
          );
          return {
            panel: shown.status,
            instanceId: shown.panel.instanceId,
            renderer: "xyg",
            title: spec.name,
            ...(args?.waitForReady
              ? { lifecycle: await shown.panel.ready }
              : {}),
          };
        } catch (error) {
          return reportEngineError("XYG visualization failed", error);
        }
      },
    ),
    vscode.commands.registerCommand(
      "graphforge.exportVisualization",
      async () => {
        try {
          const panel = XygVisualizationPanel.active();
          if (!panel) throw new Error("Open an XYG visualization first.");
          return await panel.exportPair();
        } catch (error) {
          return reportEngineError("XYG export failed", error);
        }
      },
    ),
    vscode.commands.registerCommand("graphforge.showResultGraphAdvanced", () =>
      vscode.commands.executeCommand("graphforge.showResultGraph"),
    ),
  );
}
