import * as vscode from "vscode";
import { getNativeLoadError, loadGraphForgeModule } from "./nativeLoader";
import { enforceCoreQualification, evaluateCoreVersion } from "./coreQualification";
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
  const mod = loadGraphForgeModule();
  const available = mod !== null;
  let version: string | undefined;
  try {
    version = mod?.version?.();
  } catch {
    version = undefined;
  }
  return { available, error: available ? undefined : getNativeLoadError(), version };
}

const warnedUnqualified = new Set<string>();

/**
 * Supported-Core gate (#95): refuse a Core below the declared floor, warn once
 * per runtime+version for a loadable-but-unqualified one.
 */
function gateCoreVersion(runtime: "node" | "python", version: string | undefined): void {
  const q = enforceCoreQualification(evaluateCoreVersion(runtime, version));
  if (q.status === "unqualified") {
    const key = `${runtime}:${q.version ?? ""}`;
    if (!warnedUnqualified.has(key)) {
      warnedUnqualified.add(key);
      void vscode.window.showWarningMessage(`GraphForge: ${q.message} [${q.code}] ${q.nextAction}`);
    }
  }
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

  gateCoreVersion(chosen, chosen === "node" ? node.version : python.graphforgeVersion);

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
