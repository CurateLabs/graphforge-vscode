import { NodeOnlyFeatureError, UnsupportedByBindingError } from "../session/errors";

/**
 * Pure error-presentation logic (#28), kept free of `vscode` imports so it
 * is unit testable under plain mocha (same convention as
 * `runtimeSelection.ts` / `environmentReport.ts`). The vscode-facing
 * reporter that consumes this lives in `shared.ts` (`reportEngineError`).
 */

/** Extract the engine fault-domain code (e.g. `GF_UNSUPPORTED_PROJECT_FORMAT`) when present. */
export function engineErrorCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.startsWith("GF_")) {
      return code;
    }
  }
  return undefined;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type ErrorSeverity = "warning" | "error";

/**
 * How an engine/command failure should be presented to a human (#28).
 * `message` is curated one-line toast copy; the raw diagnostics survive in
 * `detail` for structured `{ error, code }` results and the error output
 * channel — never in the toast itself.
 */
export interface PresentedError {
  severity: ErrorSeverity;
  /** Curated single-line toast copy (no raw dumps, no stack traces). */
  message: string;
  /** True when this is a missing/broken-runtime setup failure — offer setup recovery actions. */
  setup: boolean;
  /** Engine fault-domain code (`GF_*`), when the error carries one. */
  code?: string;
  /** Full raw message, preserved for agents and the output channel. */
  detail: string;
}

/**
 * Raw loader noise that must never appear in a toast or tooltip: Node
 * `require()` diagnostics and the Python loader's joined multi-interpreter
 * probe failures (#27 audit follow-up).
 */
const RUNTIME_NOISE_MARKERS = [
  "Cannot find module",
  "Require stack:",
  "graphforge not importable",
  "No Python interpreter detected",
];

/** Collapse a possibly multi-line raw message to one bounded line. */
export function oneLineSummary(message: string, max = 120): string {
  const first = message.split(/\r?\n/)[0]?.trim() ?? message;
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

/**
 * Classify an error for presentation (#28, #38):
 *
 * - {@link UnsupportedByBindingError} and {@link NodeOnlyFeatureError} are
 *   policy/capability facts, not failures — their messages already name the
 *   fix, so they get warning severity and their copy passes through intact
 *   (#38: `NodeOnlyFeatureError` gets the same softer treatment
 *   `UnsupportedByBindingError` always had).
 * - Missing/broken-runtime errors (the `describeRuntimeUnavailable` shape,
 *   or raw `require()` noise that escaped a loader) collapse to a short
 *   setup message with recovery actions.
 * - Everything else (query/user-input failures) gets a concise one-line
 *   message; the full raw text stays in `detail`.
 */
export function presentError(err: unknown): PresentedError {
  const detail = errorMessage(err);
  const code = engineErrorCode(err);

  if (err instanceof UnsupportedByBindingError || err instanceof NodeOnlyFeatureError) {
    return { severity: "warning", message: detail, setup: false, code, detail };
  }

  if (
    detail.startsWith("No usable GraphForge runtime") ||
    RUNTIME_NOISE_MARKERS.some((marker) => detail.includes(marker))
  ) {
    return {
      severity: "error",
      message: "No usable GraphForge runtime.",
      setup: true,
      code,
      detail,
    };
  }

  return { severity: "error", message: oneLineSummary(detail), setup: false, code, detail };
}
