import * as vscode from "vscode";
import { normalizeEngineVersion } from "../session/engineVersion";
import { QUALIFIED_CORE } from "../session/coreQualification";
import {
  discoverEngineVersions,
  versionChoices,
  type DiscoverTarget,
  type VersionStatus,
} from "../session/versionDiscovery";

/**
 * Inline version step for the Setup wizards (#version-picker). Seeds from the
 * `graphforge.engineVersion` setting, offers a live-discovered version list
 * (npm for the Node wizard, PyPI for the Python wizard), and always keeps a
 * "Latest" and a free-text "Pin a version…" escape so it never dead-ends when
 * discovery is offline. Persists the choice back to config and returns it, or
 * `undefined` when the user cancels (abort the install).
 *
 * Versions are labelled against `graphforge.qualifiedCore` (#95): the newest
 * qualified version is offered first, "Latest" says when the registry's latest
 * is outside the range, and refused versions are hidden (Pin still reaches them).
 */

const STATUS_NOTE: Record<VersionStatus, string> = {
  qualified: "qualified",
  unqualified: "not qualified — untested",
  unsupported: "unsupported",
};

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
  const { recommended, latestStatus, choices, hidden } = versionChoices(discovery);

  const latestNote =
    discovery.latest && latestStatus && latestStatus !== "qualified"
      ? `latest (${discovery.latest}) · ${STATUS_NOTE[latestStatus]}`
      : discovery.latest
        ? `latest (${discovery.latest})`
        : "latest";

  const items: VersionItem[] = [
    ...(recommended
      ? [{ label: `$(pass) ${recommended}`, description: "newest qualified — recommended", value: recommended }]
      : []),
    { label: LATEST_LABEL, description: latestNote, value: "latest" },
    ...choices
      .filter((c) => c.version !== recommended)
      .map<VersionItem>((c) => ({
        label: c.version,
        description: [c.isLatest ? "latest" : undefined, STATUS_NOTE[c.status]].filter(Boolean).join(" · "),
        value: c.version,
      })),
    { label: PIN_LABEL, pin: true },
  ];

  const hiddenNote = hidden > 0 ? ` · ${hidden} unsupported hidden` : "";
  const picked = await vscode.window.showQuickPick(items, {
    title: `GraphForge: engine version to install (qualified: ${QUALIFIED_CORE.range})`,
    placeHolder:
      discovery.source === "fallback" && discovery.note
        ? `${discovery.note} (current: ${current})`
        : `Current setting: ${current}${hiddenNote}`,
  });
  if (!picked) {
    return undefined;
  }

  let chosen: string;
  if (picked.pin) {
    const input = await vscode.window.showInputBox({
      title: "GraphForge: pin engine version",
      value: normalizeEngineVersion(current) ?? recommended ?? discovery.latest ?? "",
      placeHolder: `e.g. ${recommended ?? discovery.versions[0] ?? "0.6.0"} (or 'latest')`,
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
