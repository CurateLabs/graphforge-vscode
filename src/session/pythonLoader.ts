import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { probeGraphForgeImport } from "./pythonProbe";
import type { PythonInterpreterSource, PythonRuntimeStatus } from "./types";

export { probeGraphForgeImport, type GraphForgeImportProbe } from "./pythonProbe";

const VENV_DIR_NAMES = [".venv", "venv", "env", ".conda"];

export interface PythonCandidate {
  interpreterPath: string;
  source: PythonInterpreterSource;
  detail?: string;
}

let cached: PythonRuntimeStatus | undefined;
let cachedAt = 0;
const CACHE_TTL_MS = 15_000;

/** Force the next {@link resolvePythonRuntime} call to re-probe. */
export function resetPythonCache(): void {
  cached = undefined;
  cachedAt = 0;
}

/**
 * Resolve the best Python runtime candidate and probe it for an importable
 * `graphforge` package. Cached briefly (workspace/env changes are infrequent
 * relative to command invocations); call {@link resetPythonCache} after
 * config or Python-extension environment changes.
 */
export async function resolvePythonRuntime(): Promise<PythonRuntimeStatus> {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cached;
  }

  const candidates = await collectPythonCandidates();
  if (candidates.length === 0) {
    cached = {
      available: false,
      error:
        "No Python interpreter detected (no workspace venv, no ms-python.python selection, no python3/python on PATH).",
    };
    cachedAt = Date.now();
    return cached;
  }

  const errors: string[] = [];
  for (const candidate of candidates) {
    const probe = await probeGraphForgeImport(candidate.interpreterPath);
    if (probe.ok) {
      cached = {
        available: true,
        interpreter: candidate.interpreterPath,
        interpreterSource: candidate.source,
        interpreterDetail: candidate.detail,
        graphforgeVersion: probe.version,
      };
      cachedAt = Date.now();
      return cached;
    }
    errors.push(`${candidate.interpreterPath} (${candidate.source}): ${probe.error}`);
  }

  cached = {
    available: false,
    interpreter: candidates[0].interpreterPath,
    interpreterSource: candidates[0].source,
    interpreterDetail: candidates[0].detail,
    error: `graphforge not importable in any detected interpreter. Tried: ${errors.join(" | ")}`,
  };
  cachedAt = Date.now();
  return cached;
}

/**
 * Ordered interpreter candidates: explicit config override, VS Code Python
 * extension's active environment, workspace venvs, then PATH fallback.
 * Earlier entries win when probing for an importable `graphforge`.
 */
export async function collectPythonCandidates(): Promise<PythonCandidate[]> {
  const out: PythonCandidate[] = [];
  const seen = new Set<string>();
  const add = (interpreterPath: string, source: PythonInterpreterSource, detail?: string) => {
    const resolved = path.resolve(interpreterPath);
    if (seen.has(resolved)) {
      return;
    }
    seen.add(resolved);
    out.push({ interpreterPath: resolved, source, detail });
  };

  const configPath = vscode.workspace
    .getConfiguration("graphforge")
    .get<string>("pythonInterpreterPath", "")
    ?.trim();
  if (configPath) {
    add(configPath, "config");
  }

  const fromExtension = await detectPythonExtensionInterpreter();
  if (fromExtension) {
    add(fromExtension, "python-extension");
  }

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    for (const dirName of VENV_DIR_NAMES) {
      const venvRoot = path.join(folder.uri.fsPath, dirName);
      const resolved = resolveVenvInterpreter(venvRoot);
      if (resolved) {
        add(resolved, dirName === ".conda" ? "conda" : "venv", venvRoot);
      }
    }
    for (const marker of ["environment.yml", "environment.yaml", "conda-meta"]) {
      if (fs.existsSync(path.join(folder.uri.fsPath, marker))) {
        // Provenance only: we don't resolve the named conda env's interpreter
        // without invoking `conda`, which is out of scope here (#12 non-goal).
        // PATH fallback below still gives us something to probe.
        break;
      }
    }
  }

  for (const exe of pathExecutableNames()) {
    add(exe, "path");
  }

  return out;
}

function resolveVenvInterpreter(venvRoot: string): string | undefined {
  const candidates =
    process.platform === "win32"
      ? [path.join(venvRoot, "Scripts", "python.exe")]
      : [path.join(venvRoot, "bin", "python3"), path.join(venvRoot, "bin", "python")];
  return candidates.find((p) => fs.existsSync(p));
}

function pathExecutableNames(): string[] {
  return process.platform === "win32" ? ["python.exe", "python3.exe", "python"] : ["python3", "python"];
}

/**
 * Use the Microsoft Python extension's API when present to find the
 * currently selected interpreter, degrading gracefully across API shapes
 * and when the extension is absent or inactive.
 *
 * Exported (in addition to being used internally) so `projectKindDetector.ts`
 * can reuse it as a "VS Code Python interpreter set" project-kind signal
 * without re-implementing the extension-API probing.
 */
export async function detectPythonExtensionInterpreter(): Promise<string | undefined> {
  const ext = vscode.extensions.getExtension("ms-python.python");
  if (!ext) {
    return undefined;
  }
  try {
    const api = ext.isActive ? ext.exports : await ext.activate();
    const resource = vscode.workspace.workspaceFolders?.[0]?.uri;

    // Current API (2023+): environments.getActiveEnvironmentPath(resource)
    const envPath = api?.environments?.getActiveEnvironmentPath?.(resource);
    const direct = envPath?.path ?? envPath?.id;
    if (typeof direct === "string" && direct.length > 0) {
      return direct;
    }

    // Older API: settings.getExecutionDetails(resource).execCommand
    const details = api?.settings?.getExecutionDetails?.(resource);
    const execCommand: unknown = details?.execCommand;
    if (Array.isArray(execCommand) && typeof execCommand[0] === "string") {
      return execCommand[0];
    }
  } catch {
    // Extension present but API unavailable/incompatible — fall through.
  }
  return undefined;
}

