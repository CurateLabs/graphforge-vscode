import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import type { GraphPayload } from "../session/types";
import { ResultGraphPanel } from "../webview/resultGraphPanel";
import type { ResultGraphViewOptions } from "../webview/resultGraphModel";

export interface ShowResultGraphArgs extends ResultGraphViewOptions {
  title?: string;
  payload?: GraphPayload;
}

export function registerVisualizationCommands(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "graphforge.showResultGraph",
      async (args?: ShowResultGraphArgs) => {
        const result = session.getLastResult();
        const payload = args?.payload ??
          (args?.title && result
            ? await session.toGraphPayload(result, args.title)
            : await session.lastGraphPayload());
        const shown = await ResultGraphPanel.show(context.extensionUri, payload, {
          renderer: args?.renderer,
          backend: args?.backend,
          source: args?.source,
          layout: args?.layout,
          visualDensity: args?.visualDensity,
          labels: args?.labels,
          timebar: args?.timebar,
        });
        if (shown.status !== "cancelled") session.markSeenResultGraph();
        return {
          panel: shown.status,
          nodes: payload.nodes.length,
          edges: payload.edges.length,
          styleMode: payload.styleMode,
          title: payload.title,
        };
      },
    ),

    vscode.commands.registerCommand("graphforge.showResultGraphAdvanced", async () => {
      const current = session.getBeliefPolicy();
      const enabledPick = await vscode.window.showQuickPick(
        [
          { label: "Enabled", picked: current.enabled, value: true },
          { label: "Disabled (always class-only)", picked: !current.enabled, value: false },
        ],
        { title: "GraphForge: Result Graph — resolve epistemic status from ledger?" },
      );
      if (!enabledPick) return;
      const maxNodesRaw = await vscode.window.showInputBox({
        title: "GraphForge: Result Graph — max nodes to resolve",
        prompt: "Bounds belief/status lookups per render (higher = slower on large graphs)",
        value: String(current.maxNodes),
        validateInput: (value) =>
          Number.isFinite(Number(value)) && Number(value) > 0
            ? undefined
            : "Enter a positive number",
      });
      if (maxNodesRaw === undefined) return;
      session.setBeliefPolicy({
        enabled: enabledPick.value,
        maxNodes: Math.max(1, Math.trunc(Number(maxNodesRaw)) || current.maxNodes),
      });
      return vscode.commands.executeCommand("graphforge.showResultGraph");
    }),
  );
}
