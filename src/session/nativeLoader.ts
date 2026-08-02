import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { GraphForgeModule } from "./types";

let cached: GraphForgeModule | null | undefined;
let lastError: string | undefined;

export function getNativeLoadError(): string | undefined {
  return lastError;
}

export function resetNativeCache(): void {
  cached = undefined;
  lastError = undefined;
}

/**
 * Resolve @curatelabs/graphforge from config path, node_modules, or sibling monorepo.
 * Returns null when unavailable (fail closed for engine calls).
 */
export function loadGraphForgeModule(): GraphForgeModule | null {
  if (cached !== undefined) {
    return cached;
  }

  const candidates = collectCandidates();
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(candidate) as GraphForgeModule;
      if (typeof mod?.GraphForge === "function") {
        cached = mod;
        lastError = undefined;
        return cached;
      }
      errors.push(`${candidate}: no GraphForge export`);
    } catch (err) {
      errors.push(
        `${candidate}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  cached = null;
  lastError =
    errors.length > 0
      ? `GraphForge native binding unavailable. Tried: ${errors.join(" | ")}`
      : "GraphForge native binding unavailable. Install or link @curatelabs/graphforge (see README).";
  return null;
}

/**
 * Detect a locally built `graphforge-bindings-node` in a sibling `graphforge` engine
 * checkout, either next to the extension install or next to the open
 * workspace. Used by Setup UX to offer a one-click "link sibling build"
 * choice; returns undefined when no sibling build is found.
 */
export function detectSiblingBindingPath(): string | undefined {
  for (const candidate of siblingCandidatePaths()) {
    if (fs.existsSync(path.join(candidate, "index.js"))) {
      return candidate;
    }
  }
  return undefined;
}

function siblingCandidatePaths(): string[] {
  const out: string[] = [];
  const rel = path.join("graphforge", "crates", "graphforge-bindings-node");

  // Prefer the installed extension root (correct for the Vite host bundle and
  // for test chunks under dist/test/, where `__dirname` is not the package root).
  const ext = vscode.extensions.getExtension("CurateLabsAI.graphforge");
  if (ext) {
    out.push(path.resolve(ext.extensionUri.fsPath, "..", rel));
  }

  // Heuristics for plain mocha / early load before the extension activates:
  // dist/extension.js → .. ; dist/test/chunks/*.js → ../..
  for (const up of ["..", "../..", "../../.."]) {
    out.push(path.resolve(__dirname, up, rel));
  }

  // Workspace parent (opened inside monorepo tools)
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (ws) {
    out.push(path.resolve(ws, "..", rel));
  }

  return [...new Set(out)];
}

function collectCandidates(): string[] {
  const out: string[] = [];
  const configPath = vscode.workspace
    .getConfiguration("graphforge")
    .get<string>("nativeModulePath", "")
    ?.trim();

  if (configPath) {
    out.push(configPath);
  }

  out.push("@curatelabs/graphforge");

  const sibling = detectSiblingBindingPath();
  if (sibling) {
    out.push(sibling);
  }

  return [...new Set(out)];
}
