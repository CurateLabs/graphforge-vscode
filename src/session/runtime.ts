import * as vscode from "vscode";
import { getNativeLoadError, loadGraphForgeModule } from "./nativeLoader";
import { NodeEngineBackend } from "./nodeEngineBackend";
import { detectWorkspaceProjectKind } from "./projectKindDetector";
import { PythonEngineBackend } from "./pythonBridge";
import { resolvePythonRuntime } from "./pythonLoader";
import { chooseRuntime, describeRuntimeUnavailable, type NodeBindingStatus } from "./runtimeSelection";
import type { EngineBackend, PythonRuntimeStatus, RuntimePreference, WriteMode } from "./types";

export type { NodeBindingStatus } from "./runtimeSelection";
export { chooseRuntime, describeRuntimeUnavailable } from "./runtimeSelection";
export { detectWorkspaceProjectKind, type ProjectKind } from "./projectKindDetector";

/** Reads `graphforge.runtime` (default `auto`; see #12). */
export function runtimePreference(): RuntimePreference {
  const value = vscode.workspace.getConfiguration("graphforge").get<string>("runtime", "auto");
  return value === "node" || value === "python" ? value : "auto";
}

export function nodeBindingStatus(): NodeBindingStatus {
  const available = loadGraphForgeModule() !== null;
  return { available, error: available ? undefined : getNativeLoadError() };
}

export async function pythonRuntimeStatus(): Promise<PythonRuntimeStatus> {
  return resolvePythonRuntime();
}

/**
 * Resolve and open the active engine backend for `rootPath` according to
 * `graphforge.runtime`. In `auto`, a Python-first workspace (`pyproject.toml`,
 * `uv.lock`, `requirements.txt`, etc. — see `projectKind.ts`) prefers the
 * Python binding even when `@curatelabs/graphforge` is available; Node stays the
 * default for Node-ish or ambiguous repos. Fails closed with a message
 * describing both setup paths when neither runtime is usable, or when the
 * explicit preference's runtime is unavailable. `writeMode` (#11 / ADR 0015)
 * only applies to the Node path — it is a `@curatelabs/graphforge` write-coordination
 * concept with no Python-bridge equivalent yet.
 */
export async function openEngineBackend(
  rootPath: string,
  writeMode: WriteMode = "single_writer",
): Promise<EngineBackend> {
  const preference = runtimePreference();
  const node = nodeBindingStatus();
  const python = await pythonRuntimeStatus();
  const projectKind = await detectWorkspaceProjectKind(vscode.workspace.workspaceFolders, python.available);
  const chosen = chooseRuntime(preference, node, python, projectKind);

  if (!chosen) {
    throw new Error(describeRuntimeUnavailable(preference, node, python));
  }

  if (chosen === "node") {
    const mod = loadGraphForgeModule();
    if (!mod) {
      // Availability can change between the status check above and here in
      // theory (config edited concurrently); re-check rather than assume.
      throw new Error(getNativeLoadError() ?? "Native binding unavailable");
    }
    const forge = new mod.GraphForge(rootPath, { writeMode });
    return new NodeEngineBackend(forge);
  }

  if (!python.interpreter) {
    throw new Error(describeRuntimeUnavailable(preference, node, python));
  }
  return PythonEngineBackend.open(python.interpreter, rootPath);
}
