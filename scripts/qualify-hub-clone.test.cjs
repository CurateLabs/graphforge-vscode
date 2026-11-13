const assert = require("node:assert/strict");
const { test } = require("node:test");
const { resolveWindowsCli } = require("./qualify-hub-clone.cjs");
const { devContainerAuthority, remoteUri, containerFilter, containerPlatform, buildDevcontainerConfig } = require("./qualify-hub-clone-remote.cjs");

test("Windows CLI follows the actual 1.142.0 archive launcher", () => {
  // Actual bin/code.cmd from the public win32-x64-archive, rather than its
  // source template: application resources live under a versioned directory.
  const launcher = String.raw`"%~dp0..\Code.exe" "%~dp0..\6d62b1d5da\resources\app\out\cli.js" %*`;
  assert.equal(
    resolveWindowsCli(String.raw`C:\Apps\Code & Tools\Code.exe`, launcher),
    String.raw`C:\Apps\Code & Tools\6d62b1d5da\resources\app\out\cli.js`,
  );
});

test("Windows CLI also follows the earlier flat-layout launcher", () => {
  const launcher = String.raw`"%~dp0..\Code.exe" "%~dp0..\resources\app\out\cli.js" %*`;
  assert.equal(
    resolveWindowsCli(String.raw`C:\Code\Code.exe`, launcher),
    String.raw`C:\Code\resources\app\out\cli.js`,
  );
});

test("unknown or escaping Windows launchers fail explicitly", () => {
  assert.throws(() => resolveWindowsCli(String.raw`C:\Code\Code.exe`, "unknown launcher"), /does not identify/);
  const escaping = String.raw`"%~dp0..\..\other\resources\app\out\cli.js"`;
  assert.throws(() => resolveWindowsCli(String.raw`C:\Code\Code.exe`, escaping), /inside its installation/);
});

test("Dev Container authority is the hex of the host path", () => {
  const folder = "/private/tmp/work 1/gfq-abc123";
  const decode = (authority) => Buffer.from(authority.replace(/^dev-container\+/, ""), "hex").toString("utf8");
  assert.match(devContainerAuthority(folder), /^dev-container\+[0-9a-f]+$/);
  assert.equal(decode(devContainerAuthority(folder)), folder);
});

test("remote URIs need an absolute container path", () => {
  assert.equal(remoteUri("dev-container+61", "/workspaces/gfq"), "vscode-remote://dev-container+61/workspaces/gfq");
  assert.throws(() => remoteUri("dev-container+61", "workspaces/gfq"), /absolute/);
});

test("container platform matches native Docker or an explicit supported override", () => {
  assert.equal(containerPlatform("arm64"), "linux-arm64");
  assert.equal(containerPlatform("amd64"), "linux-x64");
  assert.equal(containerPlatform("arm64", "linux/amd64"), "linux-x64");
  assert.equal(containerPlatform("amd64", "linux/arm64"), "linux-arm64");
  assert.throws(() => containerPlatform("s390x"), /Unsupported/);
  assert.throws(() => containerPlatform("arm64", "windows/arm64"), /Unsupported/);
});

test("devcontainer config mounts the admitted volume and hands the lane to the remote runner", () => {
  const coreVersion = require("../package.json").dependencies["@curatelabs/graphforge"];
  const config = buildDevcontainerConfig({ workspaceName: "gfq-abc123", volumeName: "gfq-abc123-work", extensionDirName: "curatelabsai.graphforge-1.2.3", coreVersion });
  assert.deepEqual(config.mounts, ["source=gfq-abc123-work,target=/gfwork,type=volume"]);
  assert.equal(config.remoteUser, "node");
  assert.equal(config.runArgs, undefined);
  assert.deepEqual(buildDevcontainerConfig({ workspaceName: "gfq-abc123", volumeName: "v", extensionDirName: "e", coreVersion: "0.6.0-rc.5", dockerPlatform: "linux/amd64" }).runArgs, ["--platform=linux/amd64"]);
  assert.equal(config.waitFor, "postCreateCommand");
  assert.match(config.postCreateCommand, /chown node:node \/gfwork/);
  assert.doesNotMatch(config.postCreateCommand, /npm install|@curatelabs\/graphforge/);
  assert.deepEqual(config.remoteEnv, {
    GRAPHFORGE_QUALIFICATION_LANE: "dev-container",
    GRAPHFORGE_QUALIFICATION_WORK: "/gfwork",
    GRAPHFORGE_QUALIFICATION_REPORT: "/workspaces/gfq-abc123/report.json",
    GRAPHFORGE_QUALIFICATION_CORE: coreVersion,
    GRAPHFORGE_QUALIFICATION_EXTENSION: "/workspaces/gfq-abc123/extensions/curatelabsai.graphforge-1.2.3",
    GRAPHFORGE_QUALIFICATION_REJECT_BIND: "/workspaces/gfq-abc123/rejected-bind",
    GRAPHFORGE_NATIVE_MODULE: "/workspaces/gfq-abc123/extensions/curatelabsai.graphforge-1.2.3/dist/core/node_modules/@curatelabs/graphforge",
  });
});

test("container cleanup filter targets the Dev Containers host-folder label", () => {
  assert.equal(containerFilter("/private/tmp/x/gfq-abc123"), "label=devcontainer.local_folder=/private/tmp/x/gfq-abc123");
});

test("XYG remote lane uses bundled Core and an admitted temporary volume", () => {
  const config = buildDevcontainerConfig({ workspaceName: "gfq-test", volumeName: "gfq-test-work", extensionDirName: "graphforge-linux-arm64", coreVersion: "0.6.0-rc.7", xygSuite: true });
  assert.match(config.postCreateCommand, /mocha@11\.8\.0/);
  assert.doesNotMatch(config.postCreateCommand, /@curatelabs\/graphforge/);
  assert.equal(config.remoteEnv.TMPDIR, "/gfwork");
  assert.equal(config.remoteEnv.GRAPHFORGE_XYG_MOCHA, "/gfwork/test-runner/node_modules/mocha");
  assert.equal(config.remoteEnv.NODE_PATH, undefined);
  assert.equal(config.remoteEnv.GRAPHFORGE_NATIVE_MODULE, "/workspaces/gfq-test/extensions/graphforge-linux-arm64/dist/core/node_modules/@curatelabs/graphforge");
  assert.equal(config.remoteEnv.GRAPHFORGE_XYG_SOURCE, "/workspaces/gfq-test/test-source");
  assert.equal(config.remoteEnv.GRAPHFORGE_QUALIFICATION_LANE, "dev-container");
});

test("VSIX staging checks archive entries and all package provenance boundaries", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { once } = require("node:events");
  const { ZipFile } = require("yazl");
  const { stageVsix } = require("./qualify-hub-clone-remote.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gf-vsix-"));
  const version = require("../package.json").dependencies["@curatelabs/graphforge"];
  async function fixture(name, changes = {}, symlink = false, rewritePath, dos = false) {
    const zip = new ZipFile();
    const file = path.join(root, `${name}.vsix`);
    const output = fs.createWriteStream(file);
    zip.outputStream.pipe(output);
    const entries = {
      "extension/package.json": { name: "graphforge", publisher: "CurateLabsAI", version: "0.1.3" },
      "extension/dist/xyg/provenance.json": { platform: "linux-arm64" },
      "extension/dist/core/provenance.json": { platform: "linux-arm64", version },
      ...changes,
    };
    for (const [entry, value] of Object.entries(entries)) {
      zip.addBuffer(Buffer.from(symlink && entry.includes("core/provenance") ? "/host/provenance.json" : JSON.stringify(value)), entry,
        symlink && entry.includes("core/provenance") ? { mode: 0o120777 } : {});
    }
    zip.end();
    await once(output, "close");
    if (rewritePath) {
      const bytes = fs.readFileSync(file);
      const from = Buffer.from("extension/package.json");
      const to = Buffer.from(rewritePath);
      assert.equal(from.length, to.length);
      for (let at = bytes.indexOf(from); at !== -1; at = bytes.indexOf(from, at + to.length)) to.copy(bytes, at);
      fs.writeFileSync(file, bytes);
    }
    if (dos) {
      const bytes = fs.readFileSync(file);
      for (let at = 0; at < bytes.length - 46; at++) {
        if (bytes.readUInt32LE(at) !== 0x02014b50) continue;
        bytes.writeUInt16LE(20, at + 4); // MS-DOS host, ZIP version 2.0
        bytes.writeUInt32LE(0xa0000020, at + 38); // Not a Unix symlink on DOS
      }
      fs.writeFileSync(file, bytes);
    }
    const work = path.join(root, name);
    const extensions = path.join(work, "extensions");
    fs.mkdirSync(extensions, { recursive: true });
    return () => stageVsix(file, work, extensions, "linux-arm64", version);
  }
  try {
    const good = await fixture("good");
    const previousPath = process.env.PATH;
    try {
      process.env.PATH = "";
      assert.match(await good(), /curatelabsai.graphforge-0\.1\.3-linux-arm64$/);
    } finally { process.env.PATH = previousPath; }
    for (const [name, changes, pattern] of [
      ["platform", { "extension/dist/xyg/provenance.json": { platform: "darwin-arm64" } }, /linux/],
      ["host", { "extension/dist/xyg/provenance.json": { platform: "linux-x64" }, "extension/dist/core/provenance.json": { platform: "linux-x64", version } }, /architecture/],
      ["core-platform", { "extension/dist/core/provenance.json": { platform: "linux-x64", version } }, /platforms must agree/],
      ["core-version", { "extension/dist/core/provenance.json": { platform: "linux-arm64", version: "0.6.0-rc.5" } }, /pinned Core/],
      ["publisher", { "extension/package.json": { publisher: "other", name: "graphforge", version: "0.1.3" } }, /CurateLabsAI/],
    ]) await assert.rejects(await fixture(name, changes), pattern);
    assert.match(await (await fixture("dos", {}, false, undefined, true))(), /linux-arm64$/);
    await assert.rejects(await fixture("symlink", {}, true), /symbolic link/);
    assert.equal(fs.existsSync(path.join(root, "symlink", "unpacked")), false, "Reject links before creating any staged files");
    await assert.rejects(await fixture("absolute", {}, false, "/xtension/package.json"), /absolute|escaping/);
    await assert.rejects(await fixture("traversal", {}, false, "../xxxxxx/package.json"), /invalid relative path|escaping/);
    await assert.rejects(await fixture("backslash", {}, false, "extension\\package.json"), /invalid characters|backslash|escaping/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
