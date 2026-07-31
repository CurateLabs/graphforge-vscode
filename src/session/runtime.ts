import * as vscode from "vscode";
import { getNativeLoadError, loadGraphForgeModule } from "./nativeLoader";
import { NodeEngineBackend } from "./nodeEngineBackend";
import { PythonEngineBackend } from "./pythonBridge";
import { resolvePythonRuntime } from "./pythonLoader";
import { chooseRuntime, describeRuntimeUnavailable, type NodeBindingStatus } from "./runtimeSelection";
import type { EngineBackend, PythonRuntimeStatus, RuntimePreference, WriteMode } from "./types";

export type { NodeBindingStatus } from "./runtimeSelection";
export { chooseRuntime, describeRuntimeUnavailable } from "./runtimeSelection";

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
 * `graphforge.runtime`. Fails closed with a message describing both setup
 * paths when neither runtime is usable, or when the explicit preference's
 * runtime is unavailable. `writeMode` (#11 / ADR 0015) only applies to the
 * Node path — it is a `@graphforge/node` write-coordination concept with no
 * Python-bridge equivalent yet.
 */
export async function openEngineBackend(
  rootPath: string,
  writeMode: WriteMode = "single_writer",
): Promise<EngineBackend> {
  const preference = runtimePreference();
  const node = nodeBindingStatus();
  const python = await pythonRuntimeStatus();
  const chosen = chooseRuntime(preference, node, python);

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
