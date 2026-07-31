/**
 * Pure "what kind of project is this workspace" heuristic (#12 follow-up:
 * prefer Python over Node in `auto` when the workspace looks Python-first).
 * Kept free of `vscode` so it is unit testable directly under plain mocha,
 * same convention as `runtimeSelection.ts` / `environmentReport.ts`.
 */
export type ProjectKind = "python" | "node" | "ambiguous";

export interface ProjectKindSignals {
  hasPyproject: boolean;
  hasUvLock: boolean;
  hasRequirementsTxt: boolean;
  hasPythonVersionFile: boolean;
  hasPipfile: boolean;
  hasEnvironmentYml: boolean;
  hasSetupPy: boolean;
  /** True when `*.ipynb` files outnumber (or match) other source files at the workspace root. */
  notebookDominant: boolean;
  /** True when the VS Code Python extension reports an explicitly selected interpreter. */
  pythonInterpreterSelected: boolean;
  hasPackageJson: boolean;
}

export const EMPTY_PROJECT_KIND_SIGNALS: ProjectKindSignals = {
  hasPyproject: false,
  hasUvLock: false,
  hasRequirementsTxt: false,
  hasPythonVersionFile: false,
  hasPipfile: false,
  hasEnvironmentYml: false,
  hasSetupPy: false,
  notebookDominant: false,
  pythonInterpreterSelected: false,
  hasPackageJson: false,
};

/**
 * Classify a workspace as Python-first, Node-first, or ambiguous, per the
 * product rule:
 *
 * - Python markers: `pyproject.toml`, `requirements.txt`, `uv.lock`,
 *   `.python-version`, `Pipfile`, `environment.yml`, `setup.py`, a
 *   notebook-dominant root, or an explicitly selected VS Code Python
 *   interpreter.
 * - Node markers: a `package.json` (whether or not it depends on
 *   `@graphforge/node` — any `package.json` reads as "this is a JS/TS
 *   project" for this heuristic).
 * - When only one side has markers, that side wins.
 * - When **both** sides have markers, Python wins only if it's the
 *   *stronger* signal: `pyproject.toml`/`uv.lock` present (a real Python
 *   project manifest, not just a stray `requirements.txt`), or a
 *   `graphforge` Python environment is already usable. Otherwise it's
 *   ambiguous, and callers should keep Node as the default (per #12: "Node
 *   remains the global default only when the repo is Node-ish or
 *   ambiguous").
 */
export function detectProjectKind(
  signals: ProjectKindSignals,
  pythonGraphForgeUsable = false,
): ProjectKind {
  const hasPythonMarker =
    signals.hasPyproject ||
    signals.hasUvLock ||
    signals.hasRequirementsTxt ||
    signals.hasPythonVersionFile ||
    signals.hasPipfile ||
    signals.hasEnvironmentYml ||
    signals.hasSetupPy ||
    signals.notebookDominant ||
    signals.pythonInterpreterSelected;
  const hasNodeMarker = signals.hasPackageJson;

  if (hasPythonMarker && hasNodeMarker) {
    const strongPythonSignal = signals.hasPyproject || signals.hasUvLock || pythonGraphForgeUsable;
    return strongPythonSignal ? "python" : "ambiguous";
  }
  if (hasPythonMarker) {
    return "python";
  }
  if (hasNodeMarker) {
    return "node";
  }
  return "ambiguous";
}

const NOTEBOOK_EXT = ".ipynb";
const OTHER_SOURCE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".py"];

/**
 * True when `.ipynb` files are at least as common as other source files
 * among `filenames` (a shallow, workspace-root-only listing is sufficient —
 * this is a signal, not an exhaustive scan).
 */
export function isNotebookDominant(filenames: readonly string[]): boolean {
  const notebookCount = filenames.filter((f) => f.toLowerCase().endsWith(NOTEBOOK_EXT)).length;
  if (notebookCount === 0) {
    return false;
  }
  const otherSourceCount = filenames.filter((f) => {
    const lower = f.toLowerCase();
    return OTHER_SOURCE_EXTS.some((ext) => lower.endsWith(ext));
  }).length;
  return notebookCount >= otherSourceCount;
}
