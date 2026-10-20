/**
 * Discover installable graphforge versions from the public registries so the
 * Setup wizards can offer a real version list instead of a single guess.
 *
 * `vscode`-free and defensive by design: a short `fetch` timeout, an in-memory
 * cache, and a static fallback so the picker never blocks or dead-ends offline
 * — the "Pin a version…" free-text path always works regardless. `fetchImpl` /
 * `now` are injectable so the unit tests never touch the network.
 *
 * The offline fallback and the picker's qualification labels both derive from
 * the supported-Core declaration (`graphforge.qualifiedCore`, #95), so bumping
 * that range is the only edit a new Core needs here.
 */

import * as semver from "semver";
import { evaluateCoreVersion, QUALIFIED_CORE, toSemver, type QualifiedCoreDeclaration } from "./coreQualification";

export type DiscoverTarget = "npm" | "pypi";

export interface VersionDiscovery {
  /** Registry-declared latest, when known. */
  latest?: string;
  /** Available versions, newest-first. */
  versions: string[];
  source: "network" | "fallback";
  /** Human-facing reason when `source === "fallback"`; surfaced in the picker. */
  note?: string;
}

const REGISTRY_URL: Record<DiscoverTarget, string> = {
  npm: "https://registry.npmjs.org/@curatelabs/graphforge",
  pypi: "https://pypi.org/pypi/graphforge/json",
};

const DEFAULT_TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 5 * 60_000;

interface DiscoverOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const cache = new Map<DiscoverTarget, { at: number; value: VersionDiscovery }>();

/** Reset the in-memory cache (test hook). */
export function resetVersionDiscoveryCache(): void {
  cache.clear();
}

/**
 * Compare two versions descending (newest first). semver and PEP 440
 * pre-releases (`0.6.0-rc.5`, `0.6.0rc5`) use semver precedence; other shapes
 * compare segment-wise, prerelease after its numeric base, else string order.
 */
export function compareVersionsDesc(a: string, b: string): number {
  const sa = toSemver(a);
  const sb = toSemver(b);
  if (sa && sb) {
    return semver.rcompare(sa, sb);
  }
  const parse = (v: string) => v.split(/[.+-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === y) continue;
    if (x === undefined) return 1; // shorter (e.g. 0.5.0) is newer than 0.5.0-rc
    if (y === undefined) return -1;
    if (typeof x === "number" && typeof y === "number") return y - x;
    return String(y).localeCompare(String(x));
  }
  return 0;
}

/** `0.6.0-rc.5` -> `0.6.0rc5` (PyPI spelling); releases pass through. */
function toPep440(version: string): string {
  const pre = /^(\d+\.\d+\.\d+)-(alpha|beta|rc)\.(\d+)$/.exec(version);
  if (!pre) {
    return version;
  }
  const tag = pre[2] === "alpha" ? "a" : pre[2] === "beta" ? "b" : "rc";
  return `${pre[1]}${tag}${pre[3]}`;
}

/**
 * Last-resort list when the registry is unreachable: the lowest version the
 * qualified range admits, spelled for the target registry. Never a stale
 * hand-kept list.
 */
export function fallbackVersions(
  target: DiscoverTarget,
  declaration: QualifiedCoreDeclaration = QUALIFIED_CORE,
): string[] {
  const floor = semver.minVersion(declaration.range)?.version;
  if (!floor) {
    return [];
  }
  return [target === "pypi" ? toPep440(floor) : floor];
}

function fallback(target: DiscoverTarget, note: string): VersionDiscovery {
  const versions = fallbackVersions(target);
  return { versions, latest: versions[0], source: "fallback", note };
}

export type VersionStatus = "qualified" | "unqualified" | "unsupported";

export interface VersionChoice {
  version: string;
  status: VersionStatus;
  isLatest: boolean;
}

export interface VersionChoices {
  /** Newest version inside the qualified range, when discovery found one. */
  recommended?: string;
  /** Status of the registry's `latest`, so "Latest" can say when it is not qualified. */
  latestStatus?: VersionStatus;
  /** Newest-first, with versions below `refuseBelow` removed (Pin still reaches them). */
  choices: VersionChoice[];
  /** How many refused versions were hidden. */
  hidden: number;
}

/** Label discovered versions against the qualified range for the picker. Pure. */
export function versionChoices(
  discovery: VersionDiscovery,
  declaration: QualifiedCoreDeclaration = QUALIFIED_CORE,
): VersionChoices {
  const status = (v: string): VersionStatus => evaluateCoreVersion("node", v, declaration).status;
  const all = discovery.versions.map<VersionChoice>((version) => ({
    version,
    status: status(version),
    isLatest: version === discovery.latest,
  }));
  const choices = all.filter((c) => c.status !== "unsupported");
  return {
    recommended: choices.find((c) => c.status === "qualified")?.version,
    latestStatus: discovery.latest ? status(discovery.latest) : undefined,
    choices,
    hidden: all.length - choices.length,
  };
}

function parseNpm(json: unknown): { latest?: string; versions: string[] } {
  const obj = json as { versions?: Record<string, unknown>; "dist-tags"?: { latest?: string } };
  const versions = Object.keys(obj.versions ?? {});
  return { latest: obj["dist-tags"]?.latest, versions };
}

function parsePypi(json: unknown): { latest?: string; versions: string[] } {
  const obj = json as { releases?: Record<string, unknown>; info?: { version?: string } };
  const versions = Object.keys(obj.releases ?? {});
  return { latest: obj.info?.version, versions };
}

export async function discoverEngineVersions(
  target: DiscoverTarget,
  opts: DiscoverOptions = {},
): Promise<VersionDiscovery> {
  const now = opts.now ?? Date.now;
  const cached = cache.get(target);
  if (cached && now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return fallback(target, "Version discovery unavailable in this runtime.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(REGISTRY_URL[target], { signal: controller.signal });
    if (!res.ok) {
      return fallback(target, `Registry returned HTTP ${res.status}; showing the qualified Core version.`);
    }
    const json = (await res.json()) as unknown;
    const { latest, versions } = target === "npm" ? parseNpm(json) : parsePypi(json);
    if (versions.length === 0) {
      return fallback(target, "Registry listed no versions; showing the qualified Core version.");
    }
    const value: VersionDiscovery = {
      latest,
      versions: [...versions].sort(compareVersionsDesc),
      source: "network",
    };
    cache.set(target, { at: now(), value });
    return value;
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError" ? "timed out" : "failed";
    return fallback(target, `Version discovery ${reason}; showing the qualified Core version.`);
  } finally {
    clearTimeout(timer);
  }
}
