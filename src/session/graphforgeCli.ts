import * as fs from "node:fs";
import * as path from "node:path";
import { UnsupportedByBindingError } from "./errors";
import { loadGraphForgeModule } from "./nativeLoader";

/**
 * In-process GraphForge CLI wrapper (Part F): forwards to the loaded
 * `@curatelabs/graphforge` binding's `runCli()` — the same contract the
 * `@curatelabs/graphforge-cli` package uses (`packages/cli/lib/run.mjs`). No
 * shelling out and Node-runtime only, so it inherits the same availability as
 * the native binding.
 *
 * When an `@curatelabs/graphforge-cli` package is installed alongside, its
 * `project-skills/` bundle dir is prepended via `--skills-bundle-dir` so
 * `init` / `skills` install the packaged skills; when absent, that flag is
 * omitted and those subcommands degrade gracefully (everything else works via
 * the binding alone).
 */

export interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** True when the loaded native binding exposes the `runCli` contract. */
export function isCliAvailable(): boolean {
  return typeof loadGraphForgeModule()?.runCli === "function";
}

/**
 * Resolve the packaged project-skills dir from an installed
 * `@curatelabs/graphforge-cli`, or `undefined` when the optional package isn't
 * present. The specifier is held in a variable so the bundler doesn't try to
 * statically resolve the optional dependency at build time.
 */
function resolveSkillsBundleDir(): string | undefined {
  const cliPackageManifest = "@curatelabs/graphforge-cli/package.json";
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const manifestPath = require.resolve(cliPackageManifest);
    const dir = path.join(path.dirname(manifestPath), "project-skills");
    return fs.existsSync(dir) ? dir : undefined;
  } catch {
    return undefined;
  }
}

function toText(value: Buffer | string | undefined): string {
  if (value === undefined || value === null) {
    return "";
  }
  return typeof value === "string" ? value : value.toString("utf8");
}

/**
 * Run a GraphForge CLI invocation in-process. Throws
 * {@link UnsupportedByBindingError} when the loaded binding predates `runCli`
 * (or no binding is available).
 */
export function runGraphForgeCli(args: string[]): CliRunResult {
  const mod = loadGraphForgeModule();
  if (!mod || typeof mod.runCli !== "function") {
    throw new UnsupportedByBindingError("runCli");
  }
  const skillsDir = resolveSkillsBundleDir();
  const fullArgs = skillsDir ? ["--skills-bundle-dir", skillsDir, ...args] : args;
  const out = mod.runCli(fullArgs);
  return {
    exitCode: out.exitCode,
    stdout: toText(out.stdout),
    stderr: toText(out.stderr),
  };
}
