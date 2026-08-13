/**
 * Discover installable graphforge versions from the public registries so the
 * Setup wizards can offer a real version list instead of a single guess.
 *
 * `vscode`-free and defensive by design: a short `fetch` timeout, an in-memory
 * cache, and a static fallback so the picker never blocks or dead-ends offline
 * — the "Pin a version…" free-text path always works regardless. `fetchImpl` /
 * `now` are injectable so the unit tests never touch the network.
 */

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

/** Last-resort list when the registry is unreachable (keep newest-first). */
const FALLBACK_VERSIONS = ["0.5.1", "0.5.0"];

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
 * Compare two dotted versions descending (newest first). Non-numeric / prerelease
 * segments sort after their numeric base; unknown shapes fall back to string order.
 */
export function compareVersionsDesc(a: string, b: string): number {
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

function fallback(note: string): VersionDiscovery {
  return { versions: [...FALLBACK_VERSIONS], latest: FALLBACK_VERSIONS[0], source: "fallback", note };
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
    return fallback("Version discovery unavailable in this runtime.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(REGISTRY_URL[target], { signal: controller.signal });
    if (!res.ok) {
      return fallback(`Registry returned HTTP ${res.status}; showing known versions.`);
    }
    const json = (await res.json()) as unknown;
    const { latest, versions } = target === "npm" ? parseNpm(json) : parsePypi(json);
    if (versions.length === 0) {
      return fallback("Registry listed no versions; showing known versions.");
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
    return fallback(`Version discovery ${reason}; showing known versions.`);
  } finally {
    clearTimeout(timer);
  }
}
