/**
 * Deterministic Plotly figure builders from tabular QueryResult (#62).
 * Notebook/article presets only — no LLM layout.
 */

import type { PlotlyFigure } from "../webview/figureSchema";
import type { QueryResult, TableRow } from "./types";

export type FigureChartType = "bar" | "scatter" | "histogram" | "line";

export const FIGURE_CHART_TYPES: readonly FigureChartType[] = [
  "bar",
  "scatter",
  "histogram",
  "line",
] as const;

export type FigureBindings = {
  /** Category / independent axis (or histogram numeric column). */
  x?: string;
  /** Dependent axis (bar/scatter/line). */
  y?: string;
  /** Optional series grouping for bar/scatter/line. */
  color?: string;
};

export type FigureFromResultInput = {
  columns: string[];
  rows: TableRow[];
  chartType: FigureChartType;
  bindings: FigureBindings;
  title?: string;
};

export type FigureFromResultOk = { ok: true; figure: PlotlyFigure };
export type FigureFromResultErr = { ok: false; error: string; code: string };
export type FigureFromResultOutcome = FigureFromResultOk | FigureFromResultErr;

function columnValues(rows: TableRow[], column: string): unknown[] {
  return rows.map((row) => row[column]);
}

function requireColumns(
  columns: string[],
  needed: string[],
): FigureFromResultErr | undefined {
  for (const name of needed) {
    if (!columns.includes(name)) {
      return {
        ok: false,
        error: `Column "${name}" is not in the result (have: ${columns.join(", ") || "(none)"}).`,
        code: "FIGURE_COLUMN",
      };
    }
  }
  return undefined;
}

function baseLayout(title: string, xTitle?: string, yTitle?: string): PlotlyFigure["layout"] {
  return {
    title: { text: title },
    ...(xTitle ? { xaxis: { title: { text: xTitle } } } : {}),
    ...(yTitle ? { yaxis: { title: { text: yTitle } } } : {}),
    margin: { t: 48, r: 24, b: 48, l: 56 },
    autosize: true,
  };
}

function groupByColor(
  rows: TableRow[],
  colorCol: string | undefined,
): Map<string | undefined, TableRow[]> {
  const groups = new Map<string | undefined, TableRow[]>();
  if (!colorCol) {
    groups.set(undefined, rows);
    return groups;
  }
  for (const row of rows) {
    const key = row[colorCol] == null ? "(null)" : String(row[colorCol]);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return groups;
}

/**
 * Build a stable Plotly figure from tabular columns/rows.
 * Same inputs always produce the same JSON (deterministic).
 */
export function buildFigureFromResult(input: FigureFromResultInput): FigureFromResultOutcome {
  const { columns, rows, chartType, bindings, title } = input;
  if (!columns.length) {
    return { ok: false, error: "Result has no columns to chart.", code: "FIGURE_EMPTY" };
  }

  if (chartType === "histogram") {
    const x = bindings.x;
    if (!x) {
      return {
        ok: false,
        error: "Histogram requires bindings.x (numeric column).",
        code: "FIGURE_BINDINGS",
      };
    }
    const missing = requireColumns(columns, [x]);
    if (missing) {
      return missing;
    }
    const chartTitle = title ?? `Histogram of ${x}`;
    return {
      ok: true,
      figure: {
        data: [
          {
            type: "histogram",
            x: columnValues(rows, x),
            name: x,
          },
        ],
        layout: baseLayout(chartTitle, x, "Count"),
      },
    };
  }

  const x = bindings.x;
  const y = bindings.y;
  if (!x || !y) {
    return {
      ok: false,
      error: `${chartType} requires bindings.x and bindings.y.`,
      code: "FIGURE_BINDINGS",
    };
  }
  const needed = [x, y, ...(bindings.color ? [bindings.color] : [])];
  const missing = requireColumns(columns, needed);
  if (missing) {
    return missing;
  }

  const traceType = chartType === "bar" ? "bar" : chartType === "line" ? "scatter" : "scatter";
  const mode = chartType === "line" ? "lines+markers" : chartType === "scatter" ? "markers" : undefined;
  const groups = groupByColor(rows, bindings.color);
  const data = [...groups.entries()].map(([name, groupRows]) => {
    const trace: Record<string, unknown> = {
      type: traceType,
      x: columnValues(groupRows, x),
      y: columnValues(groupRows, y),
      name: name ?? y,
    };
    if (mode) {
      trace.mode = mode;
    }
    return trace;
  });

  const chartTitle = title ?? `${y} by ${x}`;
  return {
    ok: true,
    figure: {
      data,
      layout: baseLayout(chartTitle, x, y),
    },
  };
}

export function tableFromQueryResult(result: QueryResult): { columns: string[]; rows: TableRow[] } {
  return { columns: [...result.columns], rows: result.rows.map((row) => ({ ...row })) };
}
