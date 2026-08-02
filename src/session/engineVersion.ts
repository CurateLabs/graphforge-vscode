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

/** npm install spec: `@curatelabs/graphforge@0.5.1` or `@curatelabs/graphforge@latest`. */
export function npmEngineSpec(raw: string | undefined | null): string {
  return `@curatelabs/graphforge@${normalizeEngineVersion(raw) ?? LATEST}`;
}

/** PyPI requirement for uv: `graphforge==0.5.1` when pinned, else bare `graphforge`. */
export function pypiEngineSpec(raw: string | undefined | null): string {
  const version = normalizeEngineVersion(raw);
  return version ? `graphforge==${version}` : "graphforge";
}
