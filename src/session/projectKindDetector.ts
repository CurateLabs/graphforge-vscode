import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { detectPythonExtensionInterpreter } from "./pythonLoader";
import { detectProjectKind, isNotebookDominant, type ProjectKind, type ProjectKindSignals } from "./projectKind";

export { detectProjectKind, isNotebookDominant, type ProjectKind, type ProjectKindSignals } from "./projectKind";

/**
 * Gather the static, filesystem/`vscode`-derived project-kind signals for
 * `folder` (workspace root only — this is a heuristic, not an exhaustive
 * scan) and classify it. Kept separate from `projectKind.ts` so the pure
 * classification logic stays unit-testable without a `vscode` dependency.
 */
export async function detectWorkspaceProjectKind(
  folders: readonly vscode.WorkspaceFolder[] | undefined = vscode.workspace.workspaceFolders,
  pythonGraphForgeUsable = false,
): Promise<ProjectKind> {
  const folder = folders?.[0];
  if (!folder) {
    return "ambiguous";
  }
  const signals = await collectProjectKindSignals(folder.uri.fsPath);
  return detectProjectKind(signals, pythonGraphForgeUsable);
}

export async function collectProjectKindSignals(rootPath: string): Promise<ProjectKindSignals> {
  const exists = (name: string) => fs.existsSync(path.join(rootPath, name));
  const pythonInterpreterSelected = Boolean(await detectPythonExtensionInterpreter());

  return {
    hasPyproject: exists("pyproject.toml"),
    hasUvLock: exists("uv.lock"),
    hasRequirementsTxt: exists("requirements.txt"),
    hasPythonVersionFile: exists(".python-version"),
    hasPipfile: exists("Pipfile"),
    hasEnvironmentYml: exists("environment.yml") || exists("environment.yaml"),
    hasSetupPy: exists("setup.py"),
    notebookDominant: isNotebookDominant(readDirSafeNames(rootPath)),
    pythonInterpreterSelected,
    hasPackageJson: exists("package.json"),
  };
}

function readDirSafeNames(rootPath: string): string[] {
  try {
    return fs.readdirSync(rootPath);
  } catch {
    return [];
  }
}
