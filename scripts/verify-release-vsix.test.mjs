import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

// yazl is the zip writer vsce itself packages VSIXs with.
const vsceRequire = createRequire(createRequire(import.meta.url).resolve("@vscode/vsce/package.json"));
const yazl = vsceRequire("yazl");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const targets = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"];

function natives(target) {
  const [platform, arch] = target.split("-");
  const suffix = platform === "linux" ? "-gnu" : platform === "win32" ? "-msvc" : "";
  const library = platform === "darwin" ? "libxyg_core.dylib" : platform === "win32" ? "xyg_core.dll" : "libxyg_core.so";
  return [
    `extension/dist/core/node_modules/@curatelabs/graphforge-${target}${suffix}/graphforge.${target}${suffix}.node`,
    `extension/dist/xyg/node/node_modules/@curatelabs/xyg-node-${target}/${library}`,
    `extension/dist/xyg/node/node_modules/@koromix/koffi-${target}/${platform}_${arch}/koffi.node`,
  ];
}

function writeVsix(dir, name, { targetPlatform, version = pkg.version, contents }) {
  const zip = new yazl.ZipFile();
  const platform = targetPlatform ? ` TargetPlatform="${targetPlatform}"` : "";
  zip.addBuffer(
    Buffer.from(`<PackageManifest><Metadata><Identity Language="en-US" Id="${pkg.name}" Version="${version}" Publisher="${pkg.publisher}"${platform}/></Metadata></PackageManifest>`),
    "extension.vsixmanifest",
  );
  zip.addBuffer(Buffer.from(JSON.stringify({ ...pkg, version })), "extension/package.json");
  for (const entry of contents) zip.addBuffer(Buffer.from("x"), entry);
  zip.end();
  return new Promise((resolve, reject) =>
    zip.outputStream.pipe(fs.createWriteStream(path.join(dir, name))).on("close", resolve).on("error", reject),
  );
}

async function releaseSet(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-vsix-"));
  for (const target of targets) {
    const options = { targetPlatform: target, contents: natives(target), ...overrides[target] };
    if (options.skip) continue;
    await writeVsix(dir, `graphforge-${target}.vsix`, options);
  }
  return dir;
}

function verify(dir, ...args) {
  const result = spawnSync(process.execPath, ["scripts/verify-release-vsix.mjs", dir, ...args], { encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test("accepts a complete, correctly targeted release set", async () => {
  const { status, output } = verify(await releaseSet());
  assert.equal(status, 0, output);
  assert.match(output, /Release VSIX set verified/);
});

test("rejects a universal package", async () => {
  const { status, output } = verify(await releaseSet({ "linux-arm64": { targetPlatform: undefined } }));
  assert.equal(status, 1);
  assert.match(output, /graphforge-linux-arm64\.vsix: TargetPlatform is absent \(universal\)/);
});

test("rejects a package whose TargetPlatform does not match its name", async () => {
  const { status, output } = verify(await releaseSet({ "darwin-x64": { targetPlatform: "darwin-arm64" } }));
  assert.equal(status, 1);
  assert.match(output, /graphforge-darwin-x64\.vsix: TargetPlatform is darwin-arm64, expected darwin-x64/);
});

test("rejects a package carrying another platform's native binaries", async () => {
  const { status, output } = verify(await releaseSet({ "linux-arm64": { contents: natives("linux-x64") } }));
  assert.equal(status, 1);
  assert.match(output, /missing native/);
  assert.match(output, /contains linux-x64 native/);
});

test("rejects a missing target, so nothing is published from a partial set", async () => {
  const { status, output } = verify(await releaseSet({ "win32-x64": { skip: true } }));
  assert.equal(status, 1);
  assert.match(output, /missing graphforge-win32-x64\.vsix/);
});

test("rejects a version that does not match package.json", async () => {
  const { status, output } = verify(await releaseSet({ "linux-x64": { version: "0.0.1" } }));
  assert.equal(status, 1);
  assert.match(output, /graphforge-linux-x64\.vsix: version 0\.0\.1\/0\.0\.1/);
});

test("rejects unexpected VSIXs, including other targets in a single-target check", async () => {
  const { status, output } = verify(await releaseSet(), "--target", "linux-x64");
  assert.equal(status, 1);
  assert.match(output, /unexpected VSIX graphforge-win32-x64\.vsix/);
});
