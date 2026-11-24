// Release guard: asserts a directory holds exactly the platform-targeted VSIXs a
// release ships, and that each one is what its file name claims.
//
//   node scripts/verify-release-vsix.mjs <dir>                 # full release set
//   node scripts/verify-release-vsix.mjs <dir> --target <t>    # one platform build
//
// Each VSIX must be named graphforge-<target>.vsix, declare that exact
// TargetPlatform in extension.vsixmanifest (an untargeted/universal package has
// none and is rejected), carry this checkout's package.json id and version, and
// contain the native Core, XYG and koffi binaries for that target. Publishing
// steps run this before uploading anything, so a missing, extra, universal or
// mislabeled package stops the whole release rather than part of it.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { readZip } = require("@vscode/vsce/out/zip.js");

export const RELEASE_TARGETS = [
  "linux-x64",
  "linux-arm64",
  "darwin-x64",
  "darwin-arm64",
  "win32-x64",
];

function nativeEntries(target) {
  const [os, arch] = target.split("-");
  const coreSuffix = os === "linux" ? "-gnu" : os === "win32" ? "-msvc" : "";
  const library =
    os === "darwin" ? "libxyg_core.dylib" : os === "win32" ? "xyg_core.dll" : "libxyg_core.so";
  return [
    `extension/dist/core/node_modules/@curatelabs/graphforge-${target}${coreSuffix}/graphforge.${target}${coreSuffix}.node`,
    `extension/dist/xyg/node/node_modules/@curatelabs/xyg-node-${target}/${library}`,
    `extension/dist/xyg/node/node_modules/@koromix/koffi-${target}/${os}_${arch}/koffi.node`,
  ].map((entry) => entry.toLowerCase());
}

async function inspect(file) {
  const names = new Set();
  const contents = await readZip(file, (name) => {
    names.add(name);
    return name === "extension.vsixmanifest" || name === "extension/package.json";
  });
  const xml = contents.get("extension.vsixmanifest")?.toString("utf8");
  const pkg = contents.get("extension/package.json");
  if (!xml || !pkg) throw new Error(`${file}: not a VSIX (manifest missing)`);
  const identity = /<Identity\b[^>]*\/?>/.exec(xml)?.[0] ?? "";
  const attr = (key) => new RegExp(`\\b${key}="([^"]*)"`).exec(identity)?.[1];
  const manifest = JSON.parse(pkg.toString("utf8"));
  return {
    names,
    targetPlatform: attr("TargetPlatform"),
    id: `${attr("Publisher")}.${attr("Id")}`,
    version: attr("Version"),
    manifestVersion: manifest.version,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dir = args[0];
  const targetFlag = args.indexOf("--target");
  const only = targetFlag >= 0 ? args[targetFlag + 1] : undefined;
  if (!dir || (targetFlag >= 0 && !only))
    throw new Error("usage: verify-release-vsix.mjs <dir> [--target <platform>]");
  if (only && !RELEASE_TARGETS.includes(only))
    throw new Error(`${only} is not a release target (${RELEASE_TARGETS.join(", ")})`);

  const source = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const expectedId = `${source.publisher}.${source.name}`;
  const expectedTargets = only ? [only] : RELEASE_TARGETS;
  const expectedFiles = expectedTargets.map((target) => `graphforge-${target}.vsix`);
  const present = fs.readdirSync(dir).filter((name) => name.toLowerCase().endsWith(".vsix"));

  const errors = [];
  for (const name of present)
    if (!expectedFiles.includes(name)) errors.push(`unexpected VSIX ${name}`);
  const rows = [];
  for (const [index, target] of expectedTargets.entries()) {
    const name = expectedFiles[index];
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) {
      errors.push(`missing ${name}`);
      continue;
    }
    const vsix = await inspect(file);
    if (vsix.targetPlatform !== target)
      errors.push(`${name}: TargetPlatform is ${vsix.targetPlatform ?? "absent (universal)"}, expected ${target}`);
    if (vsix.id !== expectedId) errors.push(`${name}: id ${vsix.id}, expected ${expectedId}`);
    if (vsix.version !== source.version || vsix.manifestVersion !== source.version)
      errors.push(`${name}: version ${vsix.version}/${vsix.manifestVersion}, expected ${source.version}`);
    for (const entry of nativeEntries(target))
      if (!vsix.names.has(entry)) errors.push(`${name}: missing native ${entry}`);
    for (const other of RELEASE_TARGETS.filter((t) => t !== target))
      for (const entry of nativeEntries(other))
        if (vsix.names.has(entry)) errors.push(`${name}: contains ${other} native ${entry}`);
    rows.push(`${name}\t${vsix.targetPlatform ?? "universal"}\t${vsix.id}@${vsix.version}\t${fs.statSync(file).size} bytes`);
  }

  for (const row of rows) console.log(row);
  if (errors.length > 0) {
    for (const error of errors) console.error(`::error::${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Release VSIX set verified: ${expectedTargets.join(", ")} @ ${source.version}.`);
}

await main();
