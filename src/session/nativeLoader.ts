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
 * Resolve @graphforge/node from config path, node_modules, or sibling monorepo.
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
      : "GraphForge native binding unavailable. Install or link @graphforge/node (see README).";
  return null;
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

  out.push("@graphforge/node");

  // Sibling monorepo: .../graphforge-vscode next to .../graphforge
  const extensionRoot = path.resolve(__dirname, "..");
  const sibling = path.resolve(
    extensionRoot,
    "..",
    "graphforge",
    "crates",
    "gf-bindings-node",
  );
  if (fs.existsSync(path.join(sibling, "index.js"))) {
    out.push(sibling);
  }

  // Also try parent of workspace if opened inside monorepo tools
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (ws) {
    const fromWs = path.resolve(ws, "..", "graphforge", "crates", "gf-bindings-node");
    if (fs.existsSync(path.join(fromWs, "index.js"))) {
      out.push(fromWs);
    }
  }

  return [...new Set(out)];
}
