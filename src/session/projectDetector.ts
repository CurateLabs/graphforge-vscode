import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  classifyInitTarget,
  isGraphForgeProject,
  readCurrentPointer,
  readDirSafe,
  readManifestCapabilities,
  readWorkspaceOntology,
} from "./projectFormat";
import type { DetectedProject } from "./types";

export {
  classifyInitTarget,
  isGraphForgeProject,
  readCurrentPointer,
  readDirSafe,
  readManifestCapabilities,
  readWorkspaceOntology,
};

/** Discover GraphForge projects under workspace folders (roots + one level deep). */
export async function discoverProjects(
  folders: readonly vscode.WorkspaceFolder[] | undefined = vscode.workspace
    .workspaceFolders,
): Promise<DetectedProject[]> {
  if (!folders?.length) {
    return [];
  }

  const found: DetectedProject[] = [];
  const seen = new Set<string>();

  const consider = (rootPath: string, name: string) => {
    const resolved = path.resolve(rootPath);
    if (seen.has(resolved) || !isGraphForgeProject(resolved)) {
      return;
    }
    seen.add(resolved);
    found.push({
      rootPath: resolved,
      name,
      current: readCurrentPointer(resolved),
    });
  };

  for (const folder of folders) {
    consider(folder.uri.fsPath, folder.name);

    let entries: string[];
    try {
      entries = fs.readdirSync(folder.uri.fsPath);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) {
        continue;
      }
      const child = path.join(folder.uri.fsPath, entry);
      try {
        if (fs.statSync(child).isDirectory()) {
          consider(child, entry);
        }
      } catch {
        // ignore
      }
    }
  }

  return found.sort((a, b) => a.name.localeCompare(b.name));
}
