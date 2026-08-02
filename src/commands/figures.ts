import * as vscode from "vscode";
import {
  buildFigureFromResult,
  FIGURE_CHART_TYPES,
  tableFromQueryResult,
  type FigureBindings,
  type FigureChartType,
} from "../session/figureFromResult";
import type { GraphForgeSession } from "../session/graphForgeSession";
import type { TableRow } from "../session/types";
import {
  FIGURE_LIMIT_DEFAULTS,
  validateAndLimitFigure,
  type FigureLimits,
  type PlotlyFigure,
} from "../webview/figureSchema";
import { FigurePanel } from "../webview/figurePanel";
import type { CommandOutcome } from "./shared";
import { presentError } from "./shared";

export type ShowFigureArgs = {
  figure?: unknown;
};

export type FigureFromResultArgs = {
  chartType?: FigureChartType;
  x?: string;
  y?: string;
  color?: string;
  title?: string;
  columns?: string[];
  rows?: TableRow[];
  /** Alias for columns+rows when agents already have a QueryResult-shaped object. */
  table?: { columns: string[]; rows: TableRow[] };
};

export type FigureCommandSuccess = {
  figure: PlotlyFigure;
  panel: "opened" | "updated";
  chartType?: FigureChartType;
};

function readFigureLimits(): FigureLimits {
  const config = vscode.workspace.getConfiguration("graphforge");
  return {
    enabled: config.get<boolean>("figureLimitsEnabled", FIGURE_LIMIT_DEFAULTS.enabled),
    maxTraces: config.get<number>("figureMaxTraces", FIGURE_LIMIT_DEFAULTS.maxTraces),
    maxPoints: config.get<number>("figureMaxPoints", FIGURE_LIMIT_DEFAULTS.maxPoints),
    maxBytes: config.get<number>("figureMaxBytes", FIGURE_LIMIT_DEFAULTS.maxBytes),
  };
}

function presentFigure(
  extensionUri: vscode.Uri,
  figure: PlotlyFigure,
): FigureCommandSuccess {
  const { status } = FigurePanel.show(extensionUri, figure);
  return { figure, panel: status };
}

export function registerFigures(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "graphforge.showFigure",
      async (args?: ShowFigureArgs): Promise<CommandOutcome<FigureCommandSuccess>> => {
        if (args?.figure === undefined) {
          const error = "showFigure requires { figure } (Plotly figure JSON).";
          presentError(`GraphForge Figure: ${error}`);
          return {
            error,
            code: "FIGURE_REQUIRED",
            nextAction: "graphforge.figureFromResult",
          };
        }
        const checked = validateAndLimitFigure(args.figure, readFigureLimits());
        if (!checked.ok) {
          presentError(`GraphForge Figure: ${checked.error}`);
          return { error: checked.error, code: checked.code };
        }
        const shown = presentFigure(context.extensionUri, checked.figure);
        session.markSeenFigure();
        return shown;
      },
    ),

    vscode.commands.registerCommand(
      "graphforge.figureFromResult",
      async (args?: FigureFromResultArgs): Promise<CommandOutcome<FigureCommandSuccess>> => {
        const table = resolveTable(session, args);
        if ("error" in table) {
          presentError(`GraphForge Figure: ${table.error}`);
          return table;
        }

        let chartType = args?.chartType;
        let bindings: FigureBindings = {
          x: args?.x,
          y: args?.y,
          color: args?.color,
        };

        const argsComplete =
          chartType !== undefined &&
          bindings.x !== undefined &&
          (chartType === "histogram" || bindings.y !== undefined);

        if (!argsComplete) {
          const picked = await promptFigureInputs(table.columns, chartType, bindings);
          if (!picked) {
            return { cancelled: true };
          }
          chartType = picked.chartType;
          bindings = picked.bindings;
        }

        const built = buildFigureFromResult({
          columns: table.columns,
          rows: table.rows,
          chartType: chartType!,
          bindings,
          title: args?.title,
        });
        if (!built.ok) {
          presentError(`GraphForge Figure: ${built.error}`);
          return { error: built.error, code: built.code };
        }

        const checked = validateAndLimitFigure(built.figure, readFigureLimits());
        if (!checked.ok) {
          presentError(`GraphForge Figure: ${checked.error}`);
          return { error: checked.error, code: checked.code };
        }

        const shown = presentFigure(context.extensionUri, checked.figure);
        session.markSeenFigure();
        return { ...shown, chartType: chartType! };
      },
    ),
  );
}

function resolveTable(
  session: GraphForgeSession,
  args?: FigureFromResultArgs,
): { columns: string[]; rows: TableRow[] } | { error: string; code: string; nextAction?: string } {
  if (args?.table?.columns && args.table.rows) {
    return { columns: args.table.columns, rows: args.table.rows };
  }
  if (args?.columns && args.rows) {
    return { columns: args.columns, rows: args.rows };
  }
  const last = session.getLastResult();
  if (last) {
    return tableFromQueryResult(last);
  }
  return {
    error: "No result to chart. Run a query or verb first, or pass columns/rows.",
    code: "FIGURE_NO_RESULT",
    nextAction: "graphforge.runQuery",
  };
}

async function promptFigureInputs(
  columns: string[],
  chartType: FigureChartType | undefined,
  bindings: FigureBindings,
): Promise<{ chartType: FigureChartType; bindings: FigureBindings } | undefined> {
  let type = chartType;
  if (!type) {
    const pick = await vscode.window.showQuickPick(
      FIGURE_CHART_TYPES.map((value) => ({ label: value, value })),
      { title: "GraphForge: Figure chart type" },
    );
    if (!pick) {
      return undefined;
    }
    type = pick.value;
  }

  const columnItems = columns.map((c) => ({ label: c, value: c }));
  if (!columnItems.length) {
    void vscode.window.showErrorMessage("GraphForge Figure: result has no columns.");
    return undefined;
  }

  let x = bindings.x;
  if (!x) {
    const pick = await vscode.window.showQuickPick(columnItems, {
      title:
        type === "histogram"
          ? "GraphForge: Histogram column"
          : "GraphForge: X column",
    });
    if (!pick) {
      return undefined;
    }
    x = pick.value;
  }

  let y = bindings.y;
  if (type !== "histogram" && !y) {
    const pick = await vscode.window.showQuickPick(columnItems, {
      title: "GraphForge: Y column",
    });
    if (!pick) {
      return undefined;
    }
    y = pick.value;
  }

  let color = bindings.color;
  if (type !== "histogram" && color === undefined) {
    const pick = await vscode.window.showQuickPick(
      [{ label: "(none)", value: "" }, ...columnItems],
      { title: "GraphForge: Color / series column (optional)" },
    );
    if (!pick) {
      return undefined;
    }
    color = pick.value || undefined;
  }

  return { chartType: type, bindings: { x, y, color } };
}
