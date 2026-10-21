/**
 * Pure, `vscode`-free helpers for turning the `graphforge.engineVersion`
 * setting into install specifiers for the Setup wizards (#version-picker).
 * `"latest"` / `""` mean "unpinned — install whatever the registry serves as
 * latest". Kept dependency-free and unit-testable under plain mocha, mirroring
 * the `pythonInstallCommand.ts` split.
 */

/** Sentinel value of the `graphforge.engineVersion` setting meaning "unpinned". */
export const LATEST = "latest";

/**
 * Normalize the raw setting value: `undefined` for latest/empty (unpinned),
 * else the trimmed version string. Case-insensitive on the `latest` sentinel.
 */
export function normalizeEngineVersion(raw: string | undefined | null): string | undefined {
  const value = raw?.trim();
  if (!value || value.toLowerCase() === LATEST) {
    return undefined;
  }
  return value;
}

/**
 * The setting is shared by both wizards, so a Python pick may have saved the
 * PEP 440 spelling (`0.6.0rc5`). npm needs semver (`0.6.0-rc.5`); uv/pip accept
 * either, so only the npm side converts.
 */
function toNpmVersion(version: string): string {
  const pep = /^v?(\d+\.\d+\.\d+)\.?(a|b|rc|alpha|beta)\.?(\d+)$/i.exec(version);
  if (!pep) {
    return version;
  }
  const raw = pep[2].toLowerCase();
  const tag = raw === "a" ? "alpha" : raw === "b" ? "beta" : raw;
  return `${pep[1]}-${tag}.${pep[3]}`;
}

/** npm install spec: `@curatelabs/graphforge@0.5.1` or `@curatelabs/graphforge@latest`. */
export function npmEngineSpec(raw: string | undefined | null): string {
  const version = normalizeEngineVersion(raw);
  return `@curatelabs/graphforge@${version ? toNpmVersion(version) : LATEST}`;
}

/** PyPI requirement for uv: `graphforge==0.5.1` when pinned, else bare `graphforge`. */
export function pypiEngineSpec(raw: string | undefined | null): string {
  const version = normalizeEngineVersion(raw);
  return version ? `graphforge==${version}` : "graphforge";
}
