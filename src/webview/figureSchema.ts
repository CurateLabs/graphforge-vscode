/**
 * Plotly figure JSON contract + host↔webview protocol for the GraphForge
 * Figure panel (#62). Kept free of `vscode` so unit tests and the Vite
 * webview app can share the same validators.
 */

export type PlotlyTrace = Record<string, unknown> & {
  type?: string;
  x?: unknown[];
  y?: unknown[];
};

export type PlotlyLayout = Record<string, unknown>;

/** Plotly figure JSON — the shared JS/Python interchange. */
export interface PlotlyFigure {
  data: PlotlyTrace[];
  layout?: PlotlyLayout;
  frames?: unknown[];
}

export type FigureHostToWebview = (
  | { type: "graphforge/figure"; figure: PlotlyFigure }
  | { type: "graphforge/figureError"; message: string }
) & VisualizationMessageContext;

export type FigureWebviewToHost = (
  | { type: "graphforge/ready" }
  | { type: "graphforge/renderFailed"; message: string }
) & Partial<VisualizationMessageContext>;

export const FIGURE_LIMIT_DEFAULTS = {
  enabled: false,
  maxTraces: 50,
  maxPoints: 100_000,
  maxBytes: 10_000_000,
} as const;

export type FigureLimits = {
  enabled: boolean;
  maxTraces: number;
  maxPoints: number;
  maxBytes: number;
};

export type FigureValidationOk = { ok: true; figure: PlotlyFigure };
export type FigureValidationErr = { ok: false; error: string; code: string };
export type FigureValidationResult = FigureValidationOk | FigureValidationErr;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural validate — never eval. */
export function validateFigure(input: unknown): FigureValidationResult {
  if (!isPlainObject(input)) {
    return { ok: false, error: "Figure must be an object with a data array.", code: "FIGURE_INVALID" };
  }
  if (!Array.isArray(input.data)) {
    return { ok: false, error: "Figure.data must be an array of traces.", code: "FIGURE_INVALID" };
  }
  for (let i = 0; i < input.data.length; i++) {
    if (!isPlainObject(input.data[i])) {
      return {
        ok: false,
        error: `Figure.data[${i}] must be a trace object.`,
        code: "FIGURE_INVALID",
      };
    }
  }
  if (input.layout !== undefined && !isPlainObject(input.layout)) {
    return { ok: false, error: "Figure.layout must be an object when present.", code: "FIGURE_INVALID" };
  }
  if (input.frames !== undefined && !Array.isArray(input.frames)) {
    return { ok: false, error: "Figure.frames must be an array when present.", code: "FIGURE_INVALID" };
  }
  const figure: PlotlyFigure = {
    data: input.data as PlotlyTrace[],
  };
  if (input.layout !== undefined) {
    figure.layout = input.layout as PlotlyLayout;
  }
  if (input.frames !== undefined) {
    figure.frames = input.frames as unknown[];
  }
  return { ok: true, figure };
}

function countPoints(figure: PlotlyFigure): number {
  let total = 0;
  for (const trace of figure.data) {
    const xLen = Array.isArray(trace.x) ? trace.x.length : 0;
    const yLen = Array.isArray(trace.y) ? trace.y.length : 0;
    total += Math.max(xLen, yLen);
  }
  return total;
}

/** Enforce optional complexity limits (no-op when disabled). */
export function enforceFigureLimits(
  figure: PlotlyFigure,
  limits: FigureLimits,
): FigureValidationResult {
  if (!limits.enabled) {
    return { ok: true, figure };
  }
  if (figure.data.length > limits.maxTraces) {
    return {
      ok: false,
      error: `Figure has ${figure.data.length} traces; limit is ${limits.maxTraces}.`,
      code: "FIGURE_LIMITS",
    };
  }
  const points = countPoints(figure);
  if (points > limits.maxPoints) {
    return {
      ok: false,
      error: `Figure has ~${points} points; limit is ${limits.maxPoints}.`,
      code: "FIGURE_LIMITS",
    };
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(figure);
  } catch {
    return {
      ok: false,
      error: "Figure JSON could not be serialized (circular or unsupported values).",
      code: "FIGURE_INVALID",
    };
  }
  const bytes = new TextEncoder().encode(serialized).length;
  if (bytes > limits.maxBytes) {
    return {
      ok: false,
      error: `Figure JSON is ${bytes} bytes; limit is ${limits.maxBytes}.`,
      code: "FIGURE_LIMITS",
    };
  }
  return { ok: true, figure };
}

export function validateAndLimitFigure(
  input: unknown,
  limits: FigureLimits,
): FigureValidationResult {
  const validated = validateFigure(input);
  if (!validated.ok) {
    return validated;
  }
  return enforceFigureLimits(validated.figure, limits);
}
import type { VisualizationMessageContext } from "./visualizationInstanceRegistry";
