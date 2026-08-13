/**
 * Pure command-string builders for the `graphforge.setupPythonBinding` uv
 * install flow (#12, uv-only per product feedback — see `setupPython.ts`).
 * Kept `vscode`-free so the "never pip" contract is unit-testable without
 * the Extension Development Host, mirroring the `projectKind.ts` /
 * `projectKindDetector.ts` split.
 *
 * Package manager policy: **uv only, never pip.** Every string these
 * functions can return starts with `uv `; there is no code path here that
 * produces a bare `pip install` (or `pip3 install`) command. `uv pip
 * install …` is still uv — it invokes uv's own `pip`-compatible subcommand,
 * not the standalone `pip` executable.
 */

import { pypiEngineSpec } from "./engineVersion";

/**
 * Quote a requirement spec only when it carries a version operator, so the
 * shell keeps `==` intact (`"graphforge==0.5.1"`) while the unpinned form stays
 * the bare `graphforge` the uv-only contract has always emitted.
 */
function quoteSpec(spec: string): string {
  return /[=<>!~ ]/.test(spec) ? `"${spec}"` : spec;
}

/**
 * Human-facing label for the install QuickPick choice, before we know if `uv`
 * is even installed. `version` follows `graphforge.engineVersion` semantics
 * (`undefined`/`latest` = unpinned).
 */
export function describeUvInstallCommand(looksLikeUvProject: boolean, version?: string): string {
  const spec = quoteSpec(pypiEngineSpec(version));
  return looksLikeUvProject ? `uv add ${spec}` : `uv pip install ${spec}`;
}

/**
 * `uv add graphforge` when the workspace looks like a uv-managed project
 * (`pyproject.toml` / `uv.lock` present), otherwise `uv pip install
 * --python <interpreter> graphforge` targeting the resolved interpreter
 * directly. When `version` is set (not `latest`/empty) the requirement is
 * pinned (`graphforge==<version>`). Returns `undefined` only when neither a uv
 * project nor a known interpreter path is available (never falls back to
 * `pip install`).
 */
export function uvInstallCommand(
  looksLikeUvProject: boolean,
  interpreterPath: string | undefined,
  version?: string,
): string | undefined {
  const spec = quoteSpec(pypiEngineSpec(version));
  if (looksLikeUvProject) {
    return `uv add ${spec}`;
  }
  if (!interpreterPath) {
    return undefined;
  }
  return `uv pip install --python "${interpreterPath}" ${spec}`;
}
