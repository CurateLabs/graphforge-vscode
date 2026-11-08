import * as vscode from "vscode";
import { bindingVersion, isCliAvailable, runGraphForgeCli } from "../session/graphforgeCli";
import type { GraphForgeSession } from "../session/graphForgeSession";
import { isHubCloneFailure, parseHubRepository } from "../session/hubClone";
import {
  NO_PREVIEWS_REASON,
  bindingSupportsPublish,
  buildHubPublishArgs,
  describePublishSelection,
  parsePublishSelection,
  prepareHubPublishRetry,
  publishToHub,
  publishUnsupported,
  requirePublishConfirmation,
  runHubPublishRegeneration,
  type HubPublishFailure,
  type HubPublishRequest,
  type HubPublishSuccess,
} from "../session/hubPublish";
import { CommandOutcome, logErrorDetail, withEngineProgress } from "./shared";

/**
 * `GraphForge: Publish to Hub…` (#91, ADR-0005). Runs Core's `gf publish`
 * in-process for the open project; the extension never calls a Hub API and
 * stores no Hub credential. Native data only: previews wait on XYG's static
 * export (CurateLabs/xyg#935).
 */
export interface PublishToHubArgs {
  /** `owner/repo` or `https://graphforge.sh/owner/repo`. */
  repository?: string;
  /** Research Branch label whose head is published. */
  ref?: string;
  /** Exact immutable research Version UUID. */
  versionUuid?: string;
  /** Project to publish; defaults to the open project. */
  projectPath?: string;
  /** PNG/SVG previews. Not supported yet; any entry fails closed. */
  previews?: string[];
  /** Required for agent calls. */
  confirm?: boolean;
}

export type PublishToHubResult = HubPublishSuccess & {
  projectPath: string;
  /** Core binding `version()` that produced the publication. */
  coreVersion?: string;
};

const TITLE = "GraphForge: Publish to Hub…";
const PUBLISH = "Publish";

export function registerPublishToHub(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("graphforge.publishToHub", (args?: PublishToHubArgs) =>
      runPublishToHub(session, args),
    ),
  );
}

async function runPublishToHub(
  session: GraphForgeSession,
  args?: PublishToHubArgs,
  retryRequest?: HubPublishRequest,
): Promise<CommandOutcome<PublishToHubResult>> {
  // Palette calls pass no args and prompt; agents pass args and never prompt.
  const interactive = args === undefined;
  if (!isCliAvailable()) {
    return reportFailure({
      error: "Publishing to the Hub needs the Node binding (@curatelabs/graphforge), which isn't loaded.",
      code: "CLI_UNAVAILABLE",
      nextAction: 'Run "GraphForge: Setup Native Binding" (graphforge.setupNativeBinding).',
    }, interactive);
  }
  if (!bindingSupportsPublish(runGraphForgeCli)) {
    return reportFailure(publishUnsupported(), interactive);
  }

  const projectPath = retryRequest?.projectPath ?? args?.projectPath ?? session.project?.rootPath;
  if (!projectPath) {
    return reportFailure({
      error: "Open the GraphForge project to publish first.",
      code: "HUB_PUBLISH_PROJECT_REQUIRED",
      nextAction:
        'Run "GraphForge: Open Project" (graphforge.openProject), or pass projectPath.',
    }, interactive);
  }

  let request: HubPublishRequest;
  if (interactive) {
    const prompted = retryRequest ?? await promptForRequest(projectPath);
    if (!prompted) {
      return { cancelled: true };
    }
    request = prompted;
  } else {
    request = {
      repository: args.repository ?? "",
      projectPath,
      ...(args.ref !== undefined ? { ref: args.ref } : {}),
      ...(args.versionUuid !== undefined ? { versionUuid: args.versionUuid } : {}),
      ...(args.previews !== undefined ? { previews: args.previews } : {}),
    };
  }

  const validated = buildHubPublishArgs(request);
  if (!Array.isArray(validated)) {
    return reportFailure(validated, interactive);
  }
  const coreVersion = bindingVersion();
  if (interactive) {
    if (!(await confirmPublish(request, coreVersion))) {
      return { cancelled: true };
    }
  } else {
    const gate = requirePublishConfirmation(args.confirm, request);
    if (gate) {
      return gate;
    }
  }

  let outcome;
  try {
    outcome = await withEngineProgress(`Publishing to ${validated[1]}…`, async () =>
      publishToHub(request, runGraphForgeCli),
    );
  } catch (err) {
    logErrorDetail("publish to Hub failed", err);
    outcome = {
      error: `GraphForge publish failed: ${err instanceof Error ? err.message : String(err)}`,
      code: "HUB_PUBLISH_FAILED",
      nextAction: "See the GraphForge Errors output for details, then retry.",
    };
  }
  if (isHubCloneFailure(outcome)) {
    if (interactive && outcome.actions?.length) {
      return recoverPublishFailure(session, request, outcome);
    }
    return reportFailure(outcome, interactive);
  }
  if (interactive) {
    void vscode.window.showInformationMessage(
      `GraphForge: Published ${outcome.repository} (${outcome.refs.join(", ")}) at revision ${outcome.revision}.`,
    );
  }
  return { ...outcome, projectPath, ...(coreVersion ? { coreVersion } : {}) };
}

async function recoverPublishFailure(
  session: GraphForgeSession,
  request: HubPublishRequest,
  failure: HubPublishFailure,
): Promise<CommandOutcome<PublishToHubResult>> {
  const actions = failure.actions ?? [];
  const labels = actions.map(action =>
    (action.kind === "publishAsOwner" ? "Publish as the owning organization" : "Regenerate the ID") +
    (actions.length > 1 ? ` (${action.id})` : ""),
  );
  const selected = await vscode.window.showErrorMessage(`GraphForge: ${failure.error}`, ...labels);
  const action = selected === undefined ? undefined : actions[labels.indexOf(selected)];
  if (!action) return failure;
  try {
    const retry = await prepareHubPublishRetry(action, request, {
      chooseOwnerRepository: async suggested => vscode.window.showInputBox({
        title: TITLE,
        prompt: "Repository in the owning organization Core authorized. Core handles your publish identity.",
        ...(suggested ? { value: suggested } : {}),
        placeHolder: "organization/repository",
        validateInput: value => parseHubRepository(value) ? undefined : "Use owner/repository or a graphforge.sh URL.",
      }),
      confirmRegenerate: async id => {
        const choice = await vscode.window.showWarningMessage(
          `Regenerate ${id}?`,
          { modal: true, detail:
            `Core will create a new permanent ID and rewrite this project's references locally in a new Version.\n\n` +
            `Project: ${request.projectPath}\n\nThis does not publish anything.`,
          },
          "Regenerate the ID",
        );
        return choice === "Regenerate the ID";
      },
      runCli: async argv => {
        // A CLI write needs its own native handle. Release our writer and stale
        // results first, then reopen the committed project even after refusal.
        const wasOpen = session.project?.rootPath === request.projectPath;
        const writeMode = session.writeMode;
        let canRestore = true;
        try {
          if (wasOpen) {
            try { await session.closeProject(); }
            catch (error) {
              canRestore = (error as { code?: unknown } | undefined)?.code !== "PYTHON_SHUTDOWN_UNCONFIRMED";
              throw error;
            }
          }
          if (wasOpen && session.project) throw new Error("The active project changed. Publish again before regenerating.");
          return runHubPublishRegeneration(request, argv, runGraphForgeCli);
        } finally {
          if (wasOpen && canRestore && !session.project) await session.openProject(request.projectPath, writeMode);
        }
      },
    });
    if ("cancelled" in retry) return retry;
    if (isHubCloneFailure(retry)) return reportFailure(retry, true);
    if (action.kind === "regenerateId") {
      const choice = await vscode.window.showInformationMessage(
        "GraphForge: Core regenerated the ID and its local references. Publish the replacement Version when ready.",
        "Publish Again",
      );
      if (choice !== "Publish Again") return { cancelled: true };
    }
    // A fresh normal publish confirmation still gates the external write.
    return runPublishToHub(session, undefined, retry);
  } catch (error) {
    logErrorDetail("publish recovery failed", error);
    return reportFailure({
      error: error instanceof Error ? error.message : "GraphForge publish recovery failed.",
      code: "HUB_PUBLISH_RECOVERY_FAILED",
      nextAction: "Check the project state and publish again.",
    }, true);
  }
}

async function promptForRequest(projectPath: string): Promise<HubPublishRequest | undefined> {
  const repository = await vscode.window.showInputBox({
    title: TITLE,
    prompt: "GraphForge Hub repository to publish into",
    placeHolder: "owner/repository or https://graphforge.sh/owner/repository",
    validateInput: (value) =>
      parseHubRepository(value) ? undefined : "Use owner/repository (lowercase) or a graphforge.sh URL.",
  });
  if (repository === undefined) {
    return undefined;
  }
  const selection = await vscode.window.showInputBox({
    title: TITLE,
    prompt: "Research Branch label to publish, or an exact Version UUID",
    placeHolder: "main or 0193e4f6-…",
    validateInput: (value) => (value.trim() ? undefined : "Enter a Branch label or a Version UUID."),
  });
  if (selection === undefined) {
    return undefined;
  }
  return { repository, projectPath, ...parsePublishSelection(selection) };
}

async function confirmPublish(
  request: HubPublishRequest,
  coreVersion: string | undefined,
): Promise<boolean> {
  const identity = parseHubRepository(request.repository);
  const repository = identity ? `${identity.owner}/${identity.repository}` : request.repository;
  const detail = [
    `Repository: ${repository}`,
    `Publishing: ${describePublishSelection(request)}`,
    `Project: ${request.projectPath}`,
    `Producing Core version: ${coreVersion ?? "unknown"} (recorded in the Version once CurateLabs/graphforge#1769 ships)`,
    "",
    "Only native GraphForge data is published. Notebooks, apps, visualization intent " +
      "documents, and saved result snapshots stay local.",
    NO_PREVIEWS_REASON,
    "",
    "GraphForge Core handles the Hub credential; the extension stores none.",
  ].join("\n");
  const choice = await vscode.window.showWarningMessage(
    `Publish to graphforge.sh/${repository}?`,
    { modal: true, detail },
    PUBLISH,
  );
  return choice === PUBLISH;
}

function reportFailure(failure: HubPublishFailure, interactive: boolean): HubPublishFailure {
  // Agents read the structured outcome; humans get a toast without blocking it.
  if (interactive) {
    void vscode.window.showErrorMessage(`GraphForge: ${failure.error} ${failure.nextAction}`);
  }
  return failure;
}
