const assert = require("node:assert/strict");
const { test } = require("node:test");
const { resolveWindowsCli } = require("./qualify-hub-clone.cjs");
const { devContainerAuthority, remoteUri, containerFilter, buildDevcontainerConfig } = require("./qualify-hub-clone-remote.cjs");

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

test("devcontainer config mounts the admitted volume and hands the lane to the remote runner", () => {
  const config = buildDevcontainerConfig({ workspaceName: "gfq-abc123", volumeName: "gfq-abc123-work", extensionDirName: "curatelabsai.graphforge-1.2.3", coreVersion: "0.6.0-rc.5" });
  assert.deepEqual(config.mounts, ["source=gfq-abc123-work,target=/gfwork,type=volume"]);
  assert.equal(config.remoteUser, "node");
  assert.equal(config.runArgs, undefined);
  assert.deepEqual(buildDevcontainerConfig({ workspaceName: "gfq-abc123", volumeName: "v", extensionDirName: "e", coreVersion: "0.6.0-rc.5", dockerPlatform: "linux/amd64" }).runArgs, ["--platform=linux/amd64"]);
  assert.equal(config.waitFor, "postCreateCommand");
  assert.match(config.postCreateCommand, /chown node:node \/gfwork/);
  assert.match(config.postCreateCommand, /@curatelabs\/graphforge@0\.6\.0-rc\.5$/);
  assert.deepEqual(config.remoteEnv, {
    GRAPHFORGE_QUALIFICATION_LANE: "dev-container",
    GRAPHFORGE_QUALIFICATION_WORK: "/gfwork",
    GRAPHFORGE_QUALIFICATION_REPORT: "/workspaces/gfq-abc123/report.json",
    GRAPHFORGE_QUALIFICATION_CORE: "0.6.0-rc.5",
    GRAPHFORGE_QUALIFICATION_EXTENSION: "/workspaces/gfq-abc123/extensions/curatelabsai.graphforge-1.2.3",
    GRAPHFORGE_QUALIFICATION_REJECT_BIND: "/workspaces/gfq-abc123/rejected-bind",
  });
});

test("container cleanup filter targets the Dev Containers host-folder label", () => {
  assert.equal(containerFilter("/private/tmp/x/gfq-abc123"), "label=devcontainer.local_folder=/private/tmp/x/gfq-abc123");
});
