/**
 * Chart artifacts: building a deterministic Plotly figure from a result, and
 * the validation/limit pass every figure goes through before it reaches the
 * webview.
 */
import type { Bench } from "tinybench";
import {
  buildFigureFromResult,
  tableFromQueryResult,
  type FigureFromResultInput,
} from "../session/figureFromResult";
import {
  enforceFigureLimits,
  validateAndLimitFigure,
  validateFigure,
  type FigureLimits,
} from "../webview/figureSchema";
import { tabularQueryResult } from "./fixtures";

const LIMITS: FigureLimits = {
  enabled: true,
  maxTraces: 500,
  maxPoints: 1_000_000,
  maxBytes: 50_000_000,
};

export function registerFigureBenchmarks(bench: Bench): void {
  const result = tabularQueryResult(5_000, 6);
  const base = { columns: result.columns, rows: result.rows, title: "Benchmark" };
  const barInput: FigureFromResultInput = {
    ...base,
    chartType: "bar",
    bindings: { x: "carrier", y: "metric_1" },
  };
  const groupedScatterInput: FigureFromResultInput = {
    ...base,
    chartType: "scatter",
    bindings: { x: "metric_1", y: "metric_2", color: "carrier" },
  };
  const histogramInput: FigureFromResultInput = {
    ...base,
    chartType: "histogram",
    bindings: { x: "metric_3" },
  };
  const built = buildFigureFromResult(groupedScatterInput);
  const figure = built.ok ? built.figure : { data: [] };

  bench.add("figureFromResult: bar chart (5k rows)", () => {
    buildFigureFromResult(barInput);
  });

  bench.add("figureFromResult: grouped scatter (5k rows, 12 series)", () => {
    buildFigureFromResult(groupedScatterInput);
  });

  bench.add("figureFromResult: histogram (5k rows)", () => {
    buildFigureFromResult(histogramInput);
  });

  bench.add("figureFromResult: table from query result (5k rows)", () => {
    tableFromQueryResult(result);
  });

  bench.add("figureSchema: structural validation", () => {
    validateFigure(figure);
  });

  bench.add("figureSchema: enforce limits (serializes the figure)", () => {
    enforceFigureLimits(figure, LIMITS);
  });

  bench.add("figureSchema: validate and limit", () => {
    validateAndLimitFigure(figure, LIMITS);
  });
}
