import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { isCliAvailable, runGraphForgeCli } from "../session/graphforgeCli";
import {
  cloneFromHub,
  isHubCloneFailure,
  parseHubCloneUriQuery,
  parseHubRepository,
  type HubCloneSuccess,
} from "../session/hubClone";
import { CommandOutcome, logErrorDetail, withEngineProgress } from "./shared";

/**
 * `GraphForge: Clone from Hub…` (#88, ADR-0005 rollout step 2) and the
 * `vscode://curatelabsai.graphforge/clone?repository=owner/repo` link the
 * Hub's Open tab emits. Both run Core's `gf clone` in-process; the extension
 * never calls a Hub API.
 */
export interface CloneFromHubArgs {
  /** `owner/repo` or `https://graphforge.sh/owner/repo`. */
  repository?: string;
  /** Absolute path of a folder that does not exist yet. Required for agent calls. */
  destination?: string;
  /** Research Branch ref. */
  ref?: string;
  /** Immutable research Version UUID. */
  versionUuid?: string;
  /** Open the cloned project when done (agents default to false). */
  open?: boolean;
}

export type CloneFromHubResult = HubCloneSuccess & { opened: boolean };

const TITLE = "GraphForge: Clone from Hub…";

export function registerCloneFromHub(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("graphforge.cloneFromHub", (args?: CloneFromHubArgs) =>
      runCloneFromHub(args),
    ),
    vscode.window.registerUriHandler({
      handleUri: (uri) => handleHubUri(uri),
    }),
  );
}

async function handleHubUri(uri: vscode.Uri): Promise<void> {
  if (uri.path !== "/clone") {
    void vscode.window.showErrorMessage(`GraphForge: Unsupported link "${uri.path}".`);
    return;
  }
  const parsed = parseHubCloneUriQuery(uri.query);
  if (isHubCloneFailure(parsed)) {
    void vscode.window.showErrorMessage(`GraphForge: ${parsed.error} ${parsed.nextAction}`);
    return;
  }
  // A clicked link must never download silently: confirm before any disk or
  // network work.
  const selection = parsed.ref
    ? ` (branch ${parsed.ref})`
    : parsed.versionUuid
      ? ` (version ${parsed.versionUuid})`
      : "";
  const choice = await vscode.window.showInformationMessage(
    `Clone ${parsed.repository}${selection} from graphforge.sh?`,
    { modal: true, detail: "GraphForge downloads and verifies the project, then opens it." },
    "Choose Folder…",
  );
  if (choice !== "Choose Folder…") {
    return;
  }
  await runCloneFromHub({ ...parsed, open: true }, true);
}

async function runCloneFromHub(
  args?: CloneFromHubArgs,
  fromLink = false,
): Promise<CommandOutcome<CloneFromHubResult>> {
  if (!isCliAvailable()) {
    return reportFailure({
      error: "Cloning from the Hub needs the Node binding (@curatelabs/graphforge), which isn't loaded.",
      code: "CLI_UNAVAILABLE",
      nextAction: 'Run "GraphForge: Setup Native Binding" (graphforge.setupNativeBinding).',
    }, args);
  }

  // Agents pass destination and skip every prompt; palette and link calls prompt.
  const interactive = fromLink || args?.destination === undefined;
  let repository = args?.repository;
  if (repository === undefined) {
    if (!interactive) {
      return reportFailure({
        error: "A repository is required.",
        code: "HUB_REPOSITORY_INVALID",
        nextAction: "Pass repository: owner/repository or https://graphforge.sh/owner/repository.",
      }, args);
    }
    repository = await vscode.window.showInputBox({
      title: TITLE,
      prompt: "GraphForge Hub repository",
      placeHolder: "owner/repository or https://graphforge.sh/owner/repository",
      validateInput: (value) =>
        parseHubRepository(value) ? undefined : "Use owner/repository (lowercase) or a graphforge.sh URL.",
    });
    if (repository === undefined) {
      return { cancelled: true };
    }
  }

  let destination = args?.destination;
  if (destination === undefined) {
    const identity = parseHubRepository(repository);
    const parent = await vscode.window.showOpenDialog({
      title: TITLE,
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Clone Here",
    });
    if (!parent?.[0]) {
      return { cancelled: true };
    }
    destination = path.join(parent[0].fsPath, identity?.repository ?? "graphforge-project");
    if (fs.existsSync(destination)) {
      return reportFailure({
        error: `${destination} already exists.`,
        code: "HUB_CLONE_DESTINATION_EXISTS",
        nextAction: "Choose a different parent folder, or move the existing folder.",
      }, args);
    }
  }

  const request = {
    repository,
    destination,
    ...(args?.ref !== undefined ? { ref: args.ref } : {}),
    ...(args?.versionUuid !== undefined ? { versionUuid: args.versionUuid } : {}),
  };
  let outcome;
  try {
    outcome = await withEngineProgress(`Cloning ${repository}…`, async () =>
      cloneFromHub(request, runGraphForgeCli),
    );
  } catch (err) {
    logErrorDetail("clone from Hub failed", err);
    outcome = {
      error: `GraphForge clone failed: ${err instanceof Error ? err.message : String(err)}`,
      code: "HUB_CLONE_FAILED",
      nextAction: "See the GraphForge Errors output for details, then retry.",
    };
  }
  if (isHubCloneFailure(outcome)) {
    return reportFailure(outcome, args);
  }

  const shouldOpen = args?.open ?? interactive;
  let opened = false;
  if (shouldOpen) {
    const result = await vscode.commands.executeCommand<{ path?: string } | undefined>(
      "graphforge.openProject",
      outcome.destination,
    );
    opened = typeof result === "object" && result !== null && "path" in result;
  }
  void vscode.window.showInformationMessage(
    `GraphForge: Cloned ${outcome.repository} to ${outcome.destination}.`,
  );
  return { ...outcome, opened };
}

function reportFailure(
  failure: { error: string; code: string; nextAction: string },
  args?: CloneFromHubArgs,
): { error: string; code: string; nextAction: string } {
  // Agents read the structured outcome; humans get a toast without blocking it.
  if (args?.destination === undefined) {
    void vscode.window.showErrorMessage(`GraphForge: ${failure.error} ${failure.nextAction}`);
  }
  return failure;
}
