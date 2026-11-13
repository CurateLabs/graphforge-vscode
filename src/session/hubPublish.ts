import type { CliRunResult } from "./graphforgeCli";
import { randomOperationId } from "./uuid";
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

export type HubPublishRecoveryAction =
  | { kind: "publishAsOwner"; id: string; owner?: string }
  | { kind: "regenerateId"; id: string };

export type HubPublishFailure = HubCloneFailure & {
  actions?: HubPublishRecoveryAction[];
};

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
  request: { repository: string; projectPath?: string; ref?: string; versionUuid?: string },
): HubPublishFailure | undefined {
  if (confirm === true) {
    return undefined;
  }
  const selection =
    request.versionUuid !== undefined
      ? `versionUuid: ${JSON.stringify(request.versionUuid)}`
      : `ref: ${JSON.stringify(request.ref ?? "")}`;
  // Name the project explicitly so the retry cannot publish whichever one is open.
  const project =
    request.projectPath !== undefined ? `, projectPath: ${JSON.stringify(request.projectPath)}` : "";
  return {
    error: "Publishing to the Hub requires explicit { confirm: true }.",
    code: "CONFIRMATION_REQUIRED",
    nextAction: `Call graphforge.publishToHub({ repository: ${JSON.stringify(request.repository)}, ${selection}${project}, confirm: true }).`,
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

/**
 * Core's CLI deliberately exposes no Hub error body or owner metadata in JSON
 * details. Its validated, privacy-filtered next steps are native client prose
 * (Core hub_publish/refusals.rs). Recognize only those complete lines; never
 * execute a command extracted from arbitrary error text. Core's exact refusal
 * receipt remains the authority for whether regeneration is allowed.
 */
function idTakenActions(message: string): HubPublishRecoveryAction[] {
  const actions: HubPublishRecoveryAction[] = [];
  const guidance = message.replace(/^(?:validation error: )?hub\.publish\.id_taken: /, "");
  for (const line of guidance.split("\n")) {
    const ownerHint = /^(ont_[0-9a-hjkmnp-tv-z]{16}|brg_[0-9a-hjkmnp-tv-z]{16}) is taken; publish as ([a-z0-9][a-z0-9._-]{0,99}|the owning organization) instead of regenerating$/.exec(line);
    if (ownerHint) {
      actions.push({ kind: "publishAsOwner", id: ownerHint[1],
        ...(ownerHint[2] === "the owning organization" ? {} : { owner: ownerHint[2] }) });
      continue;
    }
    const regenerate = /^(ont_[0-9a-hjkmnp-tv-z]{16}|brg_[0-9a-hjkmnp-tv-z]{16}) is taken; (?:publish as [a-z0-9][a-z0-9._-]{0,99}, or )?run gf ontology regenerate-id (ont_[0-9a-hjkmnp-tv-z]{16}|brg_[0-9a-hjkmnp-tv-z]{16})$/.exec(line);
    if (regenerate && regenerate[1] === regenerate[2]) {
      actions.push({ kind: "regenerateId", id: regenerate[1] });
    }
  }
  // Offer authorized organization recovery before local rewriting.
  return actions.sort((a, b) => Number(a.kind === "regenerateId") - Number(b.kind === "regenerateId"));
}

function exactVersionRegenerationUnsupported(): HubPublishFailure {
  return {
    error: "Core's regenerate-id command cannot target an exact Version.",
    code: "HUB_ID_REGENERATION_SELECTION_UNSUPPORTED",
    nextAction: "Select the intended Branch in Core, then publish that Branch ref before regenerating its ID.",
  };
}

/** Bind status to Core's atomic Branch/head/refusal guard before rewriting. */
export function runHubPublishRegeneration(
  request: HubPublishRequest,
  args: string[],
  runCli: (args: string[]) => CliRunResult,
): CliRunResult | HubPublishFailure {
  if (request.versionUuid !== undefined) return exactVersionRegenerationUnsupported();
  const help = runCli(["ontology", "regenerate-id", "--help"]);
  if (help.exitCode !== 0 || !help.stdout.includes("--expected-branch-uuid") ||
      !help.stdout.includes("--expected-head-version-uuid")) {
    return {
      error: "The loaded Core cannot atomically guard ID regeneration by Branch and head.",
      code: "HUB_ID_REGENERATION_UNSUPPORTED",
      nextAction: 'Upgrade to GraphForge Core 0.6.0 or later, then run "GraphForge: Setup Native Binding".',
    };
  }
  const status = runCli(["status", "--project", request.projectPath, "--json"]);
  const receipt = lastJsonLine(status.stdout) as {
    label?: unknown; branch_uuid?: unknown; head_version_uuid?: unknown;
  } | undefined;
  const label = asString(receipt?.label);
  const branch = asString(receipt?.branch_uuid);
  const head = asString(receipt?.head_version_uuid);
  if (status.exitCode !== 0 || !label || !branch || !UUID.test(branch) || !head || !UUID.test(head)) {
    return {
      error: "Core could not identify the current Branch before ID regeneration.",
      code: "HUB_ID_REGENERATION_SELECTION_UNVERIFIED",
      nextAction: "Run gf status for this project, select the intended Branch, then publish its ref again.",
    };
  }
  if (request.ref !== label) {
    return {
      error: `Publish selected Branch ${request.ref ?? "(none)"}, but Core's current Branch is ${label}. No ID was regenerated.`,
      code: "HUB_ID_REGENERATION_SELECTION_MISMATCH",
      nextAction: "Select the intended Branch in Core and publish its ref again before regenerating.",
    };
  }
  // Core validates both expectations against the exact-ID refusal and retains
  // its generation comparison through publication, including other processes.
  return runCli([...args, "--expected-branch-uuid", branch, "--expected-head-version-uuid", head]);
}

/** Prepare a retry; only Core may rewrite project content, after confirmation. */
export async function prepareHubPublishRetry(
  action: HubPublishRecoveryAction,
  request: HubPublishRequest,
  recovery: {
    chooseOwnerRepository: (suggested: string | undefined) => Promise<string | undefined>;
    confirmRegenerate: (id: string) => Promise<boolean>;
    runCli: (args: string[]) => Promise<(CliRunResult | HubPublishFailure) & { reopenError?: string }>;
  },
): Promise<HubPublishRequest | HubPublishFailure | { cancelled: true }> {
  if (action.kind === "publishAsOwner") {
    const identity = parseHubRepository(request.repository);
    const suggested = action.owner && identity ? `${action.owner}/${identity.repository}` : undefined;
    const repository = await recovery.chooseOwnerRepository(suggested);
    return repository === undefined ? { cancelled: true } : { ...request, repository };
  }
  if (request.versionUuid !== undefined) return exactVersionRegenerationUnsupported();
  if (!(await recovery.confirmRegenerate(action.id))) return { cancelled: true };
  const result = await recovery.runCli([
    "ontology", "regenerate-id", action.id, "--project", request.projectPath,
    "--operation-uuid", randomOperationId(), "--yes", "--json",
  ]);
  const reopenGuidance = result.reopenError !== undefined
    ? ` Reopening the project failed: ${result.reopenError}. Reopen it before publishing again.` : "";
  if ("error" in result) return { ...result, nextAction: result.nextAction + reopenGuidance };
  if (result.exitCode !== 0) {
    const structured = lastJsonLine(result.stderr) as CoreCliError | undefined;
    return {
      error: asString(structured?.error?.message) ?? `GraphForge ID regeneration failed (exit ${result.exitCode}).`,
      code: asString(structured?.error?.details?.semantic_code) ?? asString(structured?.error?.code) ?? "HUB_ID_REGENERATION_FAILED",
      nextAction: "Resolve Core's refusal, then publish again." + reopenGuidance,
    };
  }
  const receipt = lastJsonLine(result.stdout) as { id?: unknown; version_uuid?: unknown } | undefined;
  const versionUuid = asString(receipt?.version_uuid);
  if (!asString(receipt?.id) || !versionUuid || !UUID.test(versionUuid)) {
    return {
      error: "Core completed ID regeneration without a recognized replacement Version receipt.",
      code: "HUB_ID_REGENERATION_RECEIPT_INVALID",
      nextAction: "Inspect this project's current Branch head before publishing again." + reopenGuidance,
    };
  }
  if (result.reopenError !== undefined) {
    return {
      error: `Core regenerated the ID as ${asString(receipt?.id)} in Version ${versionUuid}, but reopening failed: ${result.reopenError}.`,
      code: "HUB_ID_REGENERATION_REOPEN_FAILED",
      nextAction: `Reopen ${request.projectPath}, then publish exact Version ${versionUuid}. Do not regenerate the ID again.`,
    };
  }
  // The guarded native receipt identifies the replacement's immutable content.
  // Later Branch advancement must not change what the second confirmation publishes.
  const retry = { ...request, versionUuid };
  delete retry.ref;
  return retry;
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
    case "hub.publish.id_taken":
      return "Follow Core's ID ownership guidance above. Retry publishing after resolving the refusal.";
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
    const actions = code === "hub.publish.id_taken" ? idTakenActions(message) : undefined;
    return {
      error: message, code, nextAction: nextActionForCoreCode(code, message, repository),
      ...(actions?.length ? { actions } : {}),
    };
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
