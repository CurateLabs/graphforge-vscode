import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import {
  isVisualizationSpec,
  type ChartMark,
  type ProjectVisualizationSpec,
} from "../session/visualizationRegistry";
import { XygVisualizationPanel } from "../webview/xygPanel";
import { reportEngineError } from "./shared";

export function registerFigures(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
): void {
  const show = async (args?: {
    chartType?: ChartMark;
    x?: string;
    y?: string;
    color?: string;
    title?: string;
  }) => {
    try {
      if (
        args &&
        ("figure" in args ||
          "table" in args ||
          "rows" in args ||
          "path" in args)
      )
        throw new Error(
          "XYG_INTENT_REQUIRED: Open a saved XYG intent or supply explicit chart bindings for the current Core result.",
        );
      const result = session.getLastResult();
      if (!result) throw new Error("Run a query before creating a chart.");
      const mark =
        args?.chartType ??
        (await vscode.window.showQuickPick(
          ["bar", "scatter", "line", "histogram"] as const,
          { title: "XYG chart type" },
        ));
      if (!mark) return { cancelled: true };
      const x =
        args?.x ??
        (await vscode.window.showQuickPick(result.columns, {
          title: "XYG X field",
        }));
      if (!x) return { cancelled: true };
      const y =
        mark === "histogram"
          ? undefined
          : (args?.y ??
            (await vscode.window.showQuickPick(result.columns, {
              title: "XYG Y field",
            })));
      if (mark !== "histogram" && !y) return { cancelled: true };
      const spec: ProjectVisualizationSpec = {
        format: "xyg.intent/v1",
        name: args?.title ?? "Chart",
        result: "results/query-result.json",
        kind: "chart",
        filters: [],
        chart: { mark: mark as ChartMark, x, y, color: args?.color },
      };
      if (!isVisualizationSpec(spec))
        throw new Error("Invalid XYG chart bindings.");
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
        chartType: mark,
      };
    } catch (error) {
      return reportEngineError("XYG chart failed", error);
    }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("graphforge.figureFromResult", show),
    vscode.commands.registerCommand("graphforge.showFigure", show),
  );
}
