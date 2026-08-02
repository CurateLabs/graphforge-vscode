import * as fs from "node:fs";
import * as path from "node:path";

export const DANGEROUS_WORKSPACE_JS_SETTING =
  "modules.dangerouslyAllowWorkspaceJavaScript";

export function workspaceScriptPolicyError(
  globalSetting: boolean | undefined,
  workspaceTrusted: boolean,
): string | undefined {
  if (globalSetting !== true) {
    return "Workspace JavaScript modules are disabled. Enable the user-level Advanced setting “GraphForge: Modules: Dangerously Allow Workspace JavaScript” to continue.";
  }
  if (!workspaceTrusted) {
    return "Workspace JavaScript modules require a trusted VS Code workspace.";
  }
  return undefined;
}

export async function resolveWorkspaceScriptPath(
  manifestPath: string,
  script: string,
): Promise<string> {
  const root = await fs.promises.realpath(path.dirname(manifestPath));
  const candidate = await fs.promises.realpath(path.join(root, script));
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Workspace module script must stay inside its module folder.");
  }
  const stat = await fs.promises.stat(candidate);
  if (!stat.isFile()) throw new Error("Workspace module script must be a file.");
  return candidate;
}
