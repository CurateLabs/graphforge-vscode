import * as vscode from "vscode";
import { normalizeEngineVersion } from "../session/engineVersion";
import { discoverEngineVersions, type DiscoverTarget } from "../session/versionDiscovery";

/**
 * Inline version step for the Setup wizards (#version-picker). Seeds from the
 * `graphforge.engineVersion` setting, offers a live-discovered version list
 * (npm for the Node wizard, PyPI for the Python wizard), and always keeps a
 * "Latest" and a free-text "Pin a version…" escape so it never dead-ends when
 * discovery is offline. Persists the choice back to config and returns it, or
 * `undefined` when the user cancels (abort the install).
 */

const LATEST_LABEL = "$(cloud) Latest";
const PIN_LABEL = "$(pencil) Pin a specific version…";

interface VersionItem extends vscode.QuickPickItem {
  value?: string;
  pin?: boolean;
}

export async function pickEngineVersion(target: DiscoverTarget): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration("graphforge");
  const current = config.get<string>("engineVersion", "latest");
  const discovery = await discoverEngineVersions(target);

  const items: VersionItem[] = [
    {
      label: LATEST_LABEL,
      description: discovery.latest ? `latest (${discovery.latest})` : "latest",
      value: "latest",
    },
    ...discovery.versions.map<VersionItem>((version) => ({
      label: version,
      description: version === discovery.latest ? "latest" : undefined,
      value: version,
    })),
    { label: PIN_LABEL, pin: true },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: "GraphForge: engine version to install",
    placeHolder:
      discovery.source === "fallback" && discovery.note
        ? `${discovery.note} (current: ${current})`
        : `Current setting: ${current}`,
  });
  if (!picked) {
    return undefined;
  }

  let chosen: string;
  if (picked.pin) {
    const input = await vscode.window.showInputBox({
      title: "GraphForge: pin engine version",
      value: normalizeEngineVersion(current) ?? discovery.latest ?? "",
      placeHolder: "e.g. 0.5.1 (or 'latest')",
      prompt: "Exact version to install.",
    });
    if (input === undefined) {
      return undefined;
    }
    chosen = input.trim() || "latest";
  } else {
    chosen = picked.value ?? "latest";
  }

  await config.update("engineVersion", chosen, vscode.ConfigurationTarget.Global);
  return chosen;
}
