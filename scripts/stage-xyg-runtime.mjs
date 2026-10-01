#!/usr/bin/env node
/**
 * Stage the XYG native runtime into dist/node_modules (#80).
 *
 * The VSIX is packaged with `vsce package --no-dependencies`, and the XYG
 * Node host cannot be bundled: it locates its exact-platform native core and
 * koffi's prebuilt N-API module relative to its own files. So this copies an
 * explicit allowlist — the `@curatelabs/xyg-node` facade, every installed
 * `@curatelabs/xyg-node-<platform>` core, koffi, and koffi's installed
 * `@koromix/koffi-<platform>` prebuild — next to dist/extension.js, where
 * Node's resolution finds them. NOTICE/LICENSE files travel with each.
 *
 * npm installs only the current platform's optional packages, so a VSIX built
 * here carries this platform's native core; other platforms report
 * XYG_NATIVE_UNSUPPORTED_PLATFORM / XYG_NATIVE_LIBRARY_MISSING (or use the
 * WASM host). Per-platform VSIX targets are part of the #82 release matrix.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const source = path.join(root, "node_modules");
const target = path.join(root, "dist", "node_modules");

fs.rmSync(target, { recursive: true, force: true });

function copy(pkg, entries) {
  const from = path.join(source, pkg);
  if (!fs.existsSync(from)) throw new Error(`${pkg} is not installed; run npm install.`);
  for (const entry of entries) {
    const src = path.join(from, entry);
    if (!fs.existsSync(src)) continue;
    fs.cpSync(src, path.join(target, pkg, entry), { recursive: true });
  }
}

function installed(scope, prefix) {
  const dir = path.join(source, scope);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .map((name) => `${scope}/${name}`);
}

const legal = ["package.json", "NOTICE", "LICENSE", "LICENSE.txt", "README.md"];

copy("@curatelabs/xyg-node", [...legal, "src"]);
const cores = installed("@curatelabs", "xyg-node-");
for (const core of cores) {
  copy(core, [...legal, "index.js", "libxyg_core.so", "libxyg_core.dylib", "xyg_core.dll"]);
}
copy("koffi", [...legal, "index.js", "index.cjs", "indirect.js", "indirect.cjs", "src/koffi/index.js", "src/koffi/index.cjs", "src/koffi/indirect.js", "src/koffi/indirect.cjs", "src/koffi/src/static.js", "src/koffi/src/static.cjs", "src/koffi/src/trampolines.cjs"]);
const prebuilds = installed("@koromix", "koffi-");
for (const prebuild of prebuilds) {
  const dir = path.join(source, prebuild);
  const triplets = fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isDirectory());
  copy(prebuild, [...legal, "index.js", ...triplets]);
}

if (cores.length === 0) throw new Error("No @curatelabs/xyg-node-<platform> core is installed.");
if (prebuilds.length === 0) throw new Error("No @koromix/koffi-<platform> prebuild is installed.");
console.log(`Staged XYG runtime: ${cores.map((c) => c.split("/")[1]).join(", ")}; ${prebuilds.map((p) => p.split("/")[1]).join(", ")}`);

// Prove the staged copy is complete: load it exactly as the extension will.
const { loadXygNode } = await import(
  new URL(`file://${path.join(target, "@curatelabs", "xyg-node", "src", "load.js")}`).href
);
const loaded = await loadXygNode();
if (!loaded.ok) throw new Error(`Staged XYG runtime does not load: ${loaded.code}: ${loaded.message}`);
console.log(`Staged XYG runtime loads: native ABI ${loaded.abiVersion}`);
