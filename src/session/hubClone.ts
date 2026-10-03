import type { CliRunResult } from "./graphforgeCli";

/**
 * Open a GraphForge Hub repository through Core's `gf clone` (#88, ADR-0005).
 *
 * vscode-free so it is unit-testable. The extension never speaks the Hub
 * protocol: discovery, download, verification, and import all happen inside
 * Core's in-process CLI (`graphforge-hub-clone/1`). This module only validates
 * the request locally, builds the argv, and maps Core's JSON receipt or
 * structured error onto the extension's command outcome.
 */

export const HUB_CLONE_CONTRACT = "graphforge-hub-clone/1";
export const HUB_ORIGIN = "https://graphforge.sh";

/** Same slug rule as the Hub's protocol identity (lowercase, ≤100 chars). */
const SLUG = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const MAX_SLUG = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface HubRepositoryIdentity {
  owner: string;
  repository: string;
}

export interface HubCloneRequest {
  /** `owner/repo` or `https://graphforge.sh/owner/repo`. */
  repository: string;
  /** New project directory; must not exist (Core enforces this). */
  destination: string;
  /** Research Branch ref (`gf clone --ref`). */
  ref?: string;
  /** Immutable research Version UUID (`gf clone --version-uuid`). */
  versionUuid?: string;
}

export interface HubCloneSuccess {
  repository: string;
  destination: string;
  immutableVersion: string;
  packageDigest: string;
  generationUuid: string;
  researchVersionUuid?: string;
  researchVersionKind?: string;
}

export interface HubCloneFailure {
  error: string;
  code: string;
  nextAction: string;
}

export type HubCloneOutcome = HubCloneSuccess | HubCloneFailure;

export function isHubCloneFailure<T extends object>(
  outcome: T | HubCloneFailure,
): outcome is HubCloneFailure {
  return "error" in outcome && "code" in outcome && "nextAction" in outcome;
}

function validSlug(value: string): boolean {
  return value.length <= MAX_SLUG && SLUG.test(value);
}

/**
 * Parse `owner/repo` or a `https://graphforge.sh/owner/repo` URL. Returns
 * `undefined` for anything else; Core re-validates authoritatively.
 */
export function parseHubRepository(input: string): HubRepositoryIdentity | undefined {
  let value = input.trim();
  if (value.startsWith("https://")) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return undefined;
    }
    if (url.origin !== HUB_ORIGIN || url.search || url.hash) {
      return undefined;
    }
    value = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  }
  const parts = value.split("/");
  if (parts.length !== 2) {
    return undefined;
  }
  const [owner, repository] = parts;
  if (!validSlug(owner) || !validSlug(repository)) {
    return undefined;
  }
  return { owner, repository };
}

export interface HubCloneUriRequest {
  repository: string;
  ref?: string;
  versionUuid?: string;
}

/**
 * Parse the query of `vscode://curatelabsai.graphforge/clone?repository=…`.
 * Returns a failure for malformed links so the handler never reaches Core.
 */
export function parseHubCloneUriQuery(query: string): HubCloneUriRequest | HubCloneFailure {
  const params = new URLSearchParams(query);
  const repository = params.get("repository") ?? "";
  const identity = parseHubRepository(repository);
  if (!identity) {
    return invalidRepository(repository);
  }
  const ref = params.get("ref") ?? undefined;
  const versionUuid = params.get("version") ?? undefined;
  const selection = validateSelection(ref, versionUuid);
  if (selection) {
    return selection;
  }
  return {
    repository: `${identity.owner}/${identity.repository}`,
    ...(ref ? { ref } : {}),
    ...(versionUuid ? { versionUuid } : {}),
  };
}

function invalidRepository(input: string): HubCloneFailure {
  return {
    error: `Not a GraphForge Hub repository: "${input}".`,
    code: "HUB_REPOSITORY_INVALID",
    nextAction: "Pass owner/repository (lowercase) or https://graphforge.sh/owner/repository.",
  };
}

function validateSelection(ref?: string, versionUuid?: string): HubCloneFailure | undefined {
  if (ref !== undefined && versionUuid !== undefined) {
    return {
      error: "Choose either a ref or a version, not both.",
      code: "HUB_CLONE_SELECTION_CONFLICT",
      nextAction: "Pass only ref (a research Branch) or only versionUuid (an immutable Version).",
    };
  }
  if (ref !== undefined && (ref.trim() === "" || ref.startsWith("-"))) {
    return {
      error: `Invalid ref: "${ref}".`,
      code: "HUB_CLONE_REF_INVALID",
      nextAction: "Pass the name of a research Branch the Hub advertises.",
    };
  }
  if (versionUuid !== undefined && !UUID.test(versionUuid)) {
    return {
      error: `Invalid version UUID: "${versionUuid}".`,
      code: "HUB_CLONE_VERSION_INVALID",
      nextAction: "Pass a research Version UUID such as 0193e4f6-…",
    };
  }
  return undefined;
}

/** Validate a clone request and build Core's argv, or return a failure. */
export function buildHubCloneArgs(request: HubCloneRequest): string[] | HubCloneFailure {
  const identity = parseHubRepository(request.repository);
  if (!identity) {
    return invalidRepository(request.repository);
  }
  if (!request.destination || request.destination.startsWith("-")) {
    return {
      error: "A destination folder is required.",
      code: "HUB_CLONE_DESTINATION_REQUIRED",
      nextAction: "Pass destination: an absolute path to a folder that does not exist yet.",
    };
  }
  const selection = validateSelection(request.ref, request.versionUuid);
  if (selection) {
    return selection;
  }
  return [
    "clone",
    `${identity.owner}/${identity.repository}`,
    request.destination,
    "--json",
    ...(request.ref !== undefined ? ["--ref", request.ref] : []),
    ...(request.versionUuid !== undefined ? ["--version-uuid", request.versionUuid] : []),
  ];
}

interface CoreCloneReceipt {
  contract?: unknown;
  repository?: unknown;
  destination?: unknown;
  immutable_version?: unknown;
  package_digest?: unknown;
  generation_uuid?: unknown;
  research_version_uuid?: unknown;
  research_version_kind?: unknown;
}

interface CoreCliError {
  error?: { code?: unknown; message?: unknown; details?: { semantic_code?: unknown } };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function lastJsonLine(text: string): unknown {
  const lines = text.trim().split(/\r?\n/).filter((line) => line.trim().startsWith("{"));
  const line = lines.at(-1);
  if (!line) {
    return undefined;
  }
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/** Map one `runCli(["clone", …, "--json"])` result onto a clone outcome. */
export function interpretHubCloneResult(result: CliRunResult): HubCloneOutcome {
  if (result.exitCode === 0) {
    const receipt = lastJsonLine(result.stdout) as CoreCloneReceipt | undefined;
    const repository = asString(receipt?.repository);
    const destination = asString(receipt?.destination);
    const immutableVersion = asString(receipt?.immutable_version);
    const packageDigest = asString(receipt?.package_digest);
    const generationUuid = asString(receipt?.generation_uuid);
    if (
      receipt?.contract !== HUB_CLONE_CONTRACT ||
      !repository ||
      !destination ||
      !immutableVersion ||
      !packageDigest ||
      !generationUuid
    ) {
      return {
        error: `GraphForge clone succeeded but did not return a ${HUB_CLONE_CONTRACT} receipt.`,
        code: "HUB_CLONE_RECEIPT_INVALID",
        nextAction: "Check that @curatelabs/graphforge matches the version this extension supports.",
      };
    }
    const researchVersionUuid = asString(receipt.research_version_uuid);
    const researchVersionKind = asString(receipt.research_version_kind);
    return {
      repository,
      destination,
      immutableVersion,
      packageDigest,
      generationUuid,
      ...(researchVersionUuid ? { researchVersionUuid } : {}),
      ...(researchVersionKind ? { researchVersionKind } : {}),
    };
  }

  if (/unrecognized subcommand ['"]?clone/i.test(result.stderr)) {
    return cloneUnsupported();
  }
  const structured = lastJsonLine(result.stderr) as CoreCliError | undefined;
  // Core's semantic code (e.g. `hub.missing_ref`) is more specific than its
  // error class (e.g. `GF_VALIDATION`), so prefer it when present.
  const code =
    asString(structured?.error?.details?.semantic_code) ?? asString(structured?.error?.code);
  const message = asString(structured?.error?.message);
  if (code && message) {
    return { error: message, code, nextAction: nextActionForCoreCode(code, message) };
  }
  const text = result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`;
  return {
    error: `GraphForge clone failed: ${text}`,
    code: "HUB_CLONE_FAILED",
    nextAction: "Check the repository name and your network connection, then retry.",
  };
}

export function cloneUnsupported(): HubCloneFailure {
  return {
    error: "The loaded GraphForge binding cannot clone from the Hub.",
    code: "CLONE_UNSUPPORTED",
    nextAction:
      "Upgrade @curatelabs/graphforge to a version with `gf clone` (v0.6.0 or later), then run " +
      '"GraphForge: Setup Native Binding" (graphforge.setupNativeBinding).',
  };
}

function nextActionForCoreCode(code: string, message: string): string {
  if (/destination|exists/i.test(message)) {
    return "Choose a destination folder that does not exist yet.";
  }
  if (/hub\.(missing_ref|invalid_identity)|not.found|404/i.test(`${code} ${message}`)) {
    return "Check the repository name (and ref or version) on graphforge.sh.";
  }
  return "Check your network connection and retry; report the code if it persists.";
}

/** Run Core clone through an injected `runCli` (the binding's in-process CLI). */
export function cloneFromHub(
  request: HubCloneRequest,
  runCli: (args: string[]) => CliRunResult,
): HubCloneOutcome {
  const args = buildHubCloneArgs(request);
  if (!Array.isArray(args)) {
    return args;
  }
  return interpretHubCloneResult(runCli(args));
}
