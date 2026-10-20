import type { CliRunResult } from "./graphforgeCli";
import {
  asString,
  invalidRepository,
  lastJsonLine,
  parseHubRepository,
  UUID,
  type HubCloneFailure,
} from "./hubClone";

/**
 * Publish the open project to a GraphForge Hub through Core's `gf publish`
 * (#91, ADR-0005).
 *
 * vscode-free so it is unit-testable. Like clone, the extension never speaks
 * the Hub protocol: Core derives, verifies, and uploads the native package
 * in-process (`graphforge-hub-publish/1`) and owns the credential. This module
 * only validates the request, gates it on explicit confirmation, builds the
 * argv, and maps Core's JSON receipt or structured error onto the command
 * outcome.
 *
 * Only native GraphForge data is published. Notebooks, apps, visualization
 * intent documents, and saved result snapshots are never sent: Core's package
 * carries native content only, and the extension passes no file paths.
 */

export const HUB_PUBLISH_CONTRACT = "graphforge-hub-publish/1";

/**
 * Why previews cannot be selected yet. Previews need both Core's closed
 * preview channel in `gf publish` (`--preview`, not in the pinned Core) and
 * XYG's PNG/SVG static export (CurateLabs/xyg#935). Until both ship, every
 * publish is native data only and nothing is selected.
 */
export const NO_PREVIEWS_REASON =
  "No previews yet: visualization previews need XYG's PNG/SVG static export (CurateLabs/xyg#935) " +
  "and a Core `gf publish` that accepts preview files.";

export type HubPublishFailure = HubCloneFailure;

export interface HubPublishRequest {
  /** `owner/repo` or `https://graphforge.sh/owner/repo`. */
  repository: string;
  /** Absolute path of the GraphForge project to publish (`gf publish --project`). */
  projectPath: string;
  /** Research Branch label whose head is published (`--ref`). */
  ref?: string;
  /** Exact immutable research Version UUID (`--version-uuid`). */
  versionUuid?: string;
  /** PNG/SVG preview files. Always rejected until previews are supported. */
  previews?: readonly string[];
}

export interface HubPublishSuccess {
  repository: string;
  refs: string[];
  revision: string;
  /** `null` when this publication created the repository. */
  previousRevision: string | null;
  manifestValidator: string;
  operationUuid: string;
  requestCommitment: string;
  /** Previews sent with the Version; always empty until previews are supported. */
  previews: string[];
}

export type HubPublishOutcome = HubPublishSuccess | HubPublishFailure;

/** Ref or Version selection as shown to the human before publishing. */
export function describePublishSelection(request: { ref?: string; versionUuid?: string }): string {
  return request.versionUuid !== undefined
    ? `Version ${request.versionUuid}`
    : `Branch ${request.ref ?? "(none)"}`;
}

/**
 * Interpret one free-text selection from the palette: a UUID is an exact
 * Version, anything else is a research Branch label.
 */
export function parsePublishSelection(input: string): { ref: string } | { versionUuid: string } {
  const value = input.trim();
  return UUID.test(value) ? { versionUuid: value } : { ref: value };
}

function validateSelection(ref?: string, versionUuid?: string): HubPublishFailure | undefined {
  if (ref === undefined && versionUuid === undefined) {
    return {
      error: "Choose what to publish: a Branch ref or a Version.",
      code: "HUB_PUBLISH_SELECTION_REQUIRED",
      nextAction: "Pass ref (a research Branch label) or versionUuid (an immutable Version UUID).",
    };
  }
  if (ref !== undefined && versionUuid !== undefined) {
    return {
      error: "Choose either a ref or a version, not both.",
      code: "HUB_PUBLISH_SELECTION_CONFLICT",
      nextAction: "Pass only ref (a research Branch) or only versionUuid (an immutable Version).",
    };
  }
  if (ref !== undefined && (ref.trim() === "" || ref.startsWith("-"))) {
    return {
      error: `Invalid ref: "${ref}".`,
      code: "HUB_PUBLISH_REF_INVALID",
      nextAction: "Pass the label of a research Branch in this project.",
    };
  }
  if (versionUuid !== undefined && !UUID.test(versionUuid)) {
    return {
      error: `Invalid version UUID: "${versionUuid}".`,
      code: "HUB_PUBLISH_VERSION_INVALID",
      nextAction: "Pass a research Version UUID such as 0193e4f6-…",
    };
  }
  return undefined;
}

export function previewsUnavailable(): HubPublishFailure {
  return {
    error: "Visualization previews cannot be published yet.",
    code: "HUB_PUBLISH_PREVIEWS_UNAVAILABLE",
    nextAction: `Omit previews and publish native data only. ${NO_PREVIEWS_REASON}`,
  };
}

/** Validate a publish request and build Core's argv, or return a failure. */
export function buildHubPublishArgs(request: HubPublishRequest): string[] | HubPublishFailure {
  const identity = parseHubRepository(request.repository);
  if (!identity) {
    return invalidRepository(request.repository);
  }
  if (!request.projectPath || request.projectPath.startsWith("-")) {
    return {
      error: "A GraphForge project is required.",
      code: "HUB_PUBLISH_PROJECT_REQUIRED",
      nextAction: 'Open the project to publish with "GraphForge: Open Project" (graphforge.openProject).',
    };
  }
  const selection = validateSelection(request.ref, request.versionUuid);
  if (selection) {
    return selection;
  }
  if (request.previews !== undefined && request.previews.length > 0) {
    return previewsUnavailable();
  }
  return [
    "publish",
    `${identity.owner}/${identity.repository}`,
    "--project",
    request.projectPath,
    "--json",
    ...(request.ref !== undefined ? ["--ref", request.ref] : []),
    ...(request.versionUuid !== undefined ? ["--version-uuid", request.versionUuid] : []),
  ];
}

/**
 * Agent calls must pass `confirm: true` (like `graphforge.applyProjectMutation`);
 * interactive calls confirm through a modal instead.
 */
export function requirePublishConfirmation(
  confirm: unknown,
  request: { repository: string; ref?: string; versionUuid?: string },
): HubPublishFailure | undefined {
  if (confirm === true) {
    return undefined;
  }
  const selection =
    request.versionUuid !== undefined
      ? `versionUuid: ${JSON.stringify(request.versionUuid)}`
      : `ref: ${JSON.stringify(request.ref ?? "")}`;
  return {
    error: "Publishing to the Hub requires explicit { confirm: true }.",
    code: "CONFIRMATION_REQUIRED",
    nextAction: `Call graphforge.publishToHub({ repository: ${JSON.stringify(request.repository)}, ${selection}, confirm: true }).`,
  };
}

interface CorePublishReceipt {
  format?: unknown;
  operation_uuid?: unknown;
  request_commitment?: unknown;
  repository?: { owner?: unknown; repository?: unknown };
  manifest_validator?: unknown;
  refs?: unknown;
  previous_revision?: unknown;
  revision?: unknown;
}

interface CoreCliError {
  error?: { code?: unknown; message?: unknown; details?: { semantic_code?: unknown } };
}

function receiptInvalid(): HubPublishFailure {
  return {
    error: `GraphForge publish succeeded but did not return a ${HUB_PUBLISH_CONTRACT} receipt.`,
    code: "HUB_PUBLISH_RECEIPT_INVALID",
    nextAction:
      "Check the repository on graphforge.sh, and that @curatelabs/graphforge matches the version this extension supports.",
  };
}

function interpretReceipt(stdout: string): HubPublishOutcome {
  const receipt = lastJsonLine(stdout) as CorePublishReceipt | undefined;
  const owner = asString(receipt?.repository?.owner);
  const name = asString(receipt?.repository?.repository);
  const revision = asString(receipt?.revision);
  const manifestValidator = asString(receipt?.manifest_validator);
  const operationUuid = asString(receipt?.operation_uuid);
  const requestCommitment = asString(receipt?.request_commitment);
  const refs = receipt?.refs;
  const previous = receipt?.previous_revision;
  if (
    receipt?.format !== HUB_PUBLISH_CONTRACT ||
    !owner ||
    !name ||
    !revision ||
    !manifestValidator ||
    !operationUuid ||
    !requestCommitment ||
    !Array.isArray(refs) ||
    !refs.every((ref) => typeof ref === "string") ||
    (previous !== null && asString(previous) === undefined)
  ) {
    return receiptInvalid();
  }
  return {
    repository: `${owner}/${name}`,
    refs: refs as string[],
    revision,
    previousRevision: previous as string | null,
    manifestValidator,
    operationUuid,
    requestCommitment,
    previews: [],
  };
}

/**
 * Core states a missing credential as `<code>: no publish credential: <action>`
 * (or `no saved session: <action>` once `gf auth login` exists). Return Core's
 * action verbatim so its login guidance reaches the caller unchanged.
 */
function coreCredentialAction(message: string): string | undefined {
  return /\b(?:no publish credential|no saved session):\s*(.+)$/is.exec(message)?.[1]?.trim();
}

function nextActionForCoreCode(code: string, message: string, repository?: string): string {
  const credentialAction = coreCredentialAction(message);
  if (credentialAction) {
    return `${credentialAction.charAt(0).toUpperCase()}${credentialAction.slice(1)}. The extension stores no Hub credential.`;
  }
  const where = repository ?? "the repository";
  switch (code) {
    case "hub.publish.auth_denied":
      return "The Hub refused the publish credential. Refresh GRAPHFORGE_HUB_PUBLISH_TOKEN, or run gf publish in a terminal to sign in again.";
    case "hub.publish.entitlement_denied":
      return `Check that your graphforge.sh account may publish to ${where}.`;
    case "hub.publish.ref_conflict":
      return `${where} changed since Core read it. Publish again.`;
    case "hub.publish.idempotency_conflict":
      return "This operation identity was already used for different content. Capture a new Version, or publish a different ref.";
    case "hub.publish.unsupported_future":
      return "The Hub needs a newer GraphForge. Upgrade @curatelabs/graphforge, then retry.";
    case "hub.publish.integrity_failure":
      return "The Hub refused corrupted bytes. Retry; report the code if it persists.";
    case "hub.invalid_identity":
      return "Pass owner/repository (lowercase) or https://graphforge.sh/owner/repository.";
    default:
      if (code.startsWith("hub.publish.derivation")) {
        return "Check that the ref names a research Branch (or the UUID an immutable Version) in this project.";
      }
      if (/not.found|missing/i.test(`${code} ${message}`)) {
        return "Check the ref or Version UUID against this project's research Branches and Versions.";
      }
      return "Check your network connection and retry; report the code if it persists.";
  }
}

/** Map one `runCli(["publish", …, "--json"])` result onto a publish outcome. */
export function interpretHubPublishResult(
  result: CliRunResult,
  repository?: string,
): HubPublishOutcome {
  if (result.exitCode === 0) {
    return interpretReceipt(result.stdout);
  }
  if (/unrecognized subcommand ['"]?publish/i.test(result.stderr)) {
    return publishUnsupported();
  }
  const structured = lastJsonLine(result.stderr) as CoreCliError | undefined;
  const message = asString(structured?.error?.message);
  // Core's semantic code (e.g. `hub.publish.auth_denied`) is more specific than
  // its error class (e.g. `GF_VALIDATION`). Older Cores carry it only as the
  // message prefix, so fall back to that before the class.
  const code =
    asString(structured?.error?.details?.semantic_code) ??
    (message ? /\b(hub\.[a-z_.]+?):/.exec(message)?.[1] : undefined) ??
    asString(structured?.error?.code);
  if (code && message) {
    return { error: message, code, nextAction: nextActionForCoreCode(code, message, repository) };
  }
  // Never echo Core's raw output: it can name project content.
  return {
    error: `GraphForge publish failed (exit ${result.exitCode}).`,
    code: "HUB_PUBLISH_FAILED",
    nextAction: "Check the repository name and your network connection, then retry.",
  };
}

export function publishUnsupported(): HubPublishFailure {
  return {
    error: "The loaded GraphForge binding cannot publish to the Hub.",
    code: "PUBLISH_UNSUPPORTED",
    nextAction:
      "Upgrade @curatelabs/graphforge to a version with `gf publish` (v0.6.0 or later), then run " +
      '"GraphForge: Setup Native Binding" (graphforge.setupNativeBinding).',
  };
}

/**
 * True when the binding's CLI has `gf publish`. Probes `publish --help`, which
 * reads nothing and makes no network call, so a 0.5.x binding fails closed
 * before any prompt.
 */
export function bindingSupportsPublish(runCli: (args: string[]) => CliRunResult): boolean {
  const result = runCli(["publish", "--help"]);
  return result.exitCode === 0 && !/unrecognized subcommand/i.test(result.stderr);
}

/** Run Core publish through an injected `runCli` (the binding's in-process CLI). */
export function publishToHub(
  request: HubPublishRequest,
  runCli: (args: string[]) => CliRunResult,
): HubPublishOutcome {
  const args = buildHubPublishArgs(request);
  if (!Array.isArray(args)) {
    return args;
  }
  return interpretHubPublishResult(runCli(args), args[1]);
}
