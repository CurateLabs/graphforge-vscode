/* Remote extension host (Dev Container) storage qualification (#94). Local-only: needs a desktop VS Code driving Docker. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash, randomBytes } = require("node:crypto");
const { execFileSync } = require("node:child_process");

// Dev Containers addresses a local folder as dev-container+<hex of the host path>.
const devContainerAuthority = (hostFolder) => `dev-container+${Buffer.from(hostFolder, "utf8").toString("hex")}`;
function remoteUri(authority, containerPath) {
  assert.ok(containerPath.startsWith("/"), "Container path must be absolute");
  return `vscode-remote://${authority}${containerPath}`;
}
// Dev Containers labels the container with the host folder it was opened from.
const containerFilter = (hostFolder) => `label=devcontainer.local_folder=${hostFolder}`;

function buildDevcontainerConfig({ workspaceName, volumeName, extensionDirName, coreVersion, dockerPlatform }) {
  const workspace = `/workspaces/${workspaceName}`;
  return {
    name: "graphforge-hub-clone-qualification",
    image: "mcr.microsoft.com/devcontainers/javascript-node:22",
    // Optional Docker platform (e.g. linux/amd64 on an arm64 desktop) selects the engine host architecture.
    ...(dockerPlatform ? { runArgs: [`--platform=${dockerPlatform}`] } : {}),
    remoteUser: "node",
    // A named volume is ext4 beneath the overlay root; the bind mount below is the host's file sharing.
    mounts: [`source=${volumeName},target=/gfwork,type=volume`],
    waitFor: "postCreateCommand",
    postCreateCommand: `sudo chown node:node /gfwork && npm install --prefix /gfwork/binding --no-package-lock --no-save --no-audit --no-fund @curatelabs/graphforge@${coreVersion}`,
    remoteEnv: {
      GRAPHFORGE_QUALIFICATION_LANE: "dev-container",
      GRAPHFORGE_QUALIFICATION_WORK: "/gfwork",
      GRAPHFORGE_QUALIFICATION_REPORT: `${workspace}/report.json`,
      GRAPHFORGE_QUALIFICATION_CORE: coreVersion,
      GRAPHFORGE_QUALIFICATION_EXTENSION: `${workspace}/extensions/${extensionDirName}`,
      GRAPHFORGE_QUALIFICATION_REJECT_BIND: `${workspace}/rejected-bind`,
    },
  };
}
Object.assign(exports, { devContainerAuthority, remoteUri, containerFilter, buildDevcontainerConfig });

// Bounded so an unresponsive daemon cannot stall the watchdog or cleanup.
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

async function main() {
  const vsix = path.resolve(process.argv[2] ?? "graphforge-ci.vsix");
  const evidence = path.resolve(process.argv[3] ?? "dev-container-evidence");
  const coreVersion = "0.6.0-rc.5";
  const vscodeVersion = "1.142.0";
  const watchdogMs = 25 * 60 * 1000;
  assert.ok(fs.statSync(vsix).isFile(), "Pass an existing packaged VSIX");
  assert.ok(process.env.npm_execpath, "Run through npm run qualify:hub-clone:dev-container -- <vsix> <evidence-directory>");
  // The mount expectations (ext4 volume, non-admitted virtiofs bind mount) are Docker Desktop on macOS.
  assert.equal(process.platform, "darwin", "The Dev Container lane runs from a macOS desktop with Docker Desktop");
  const dockerServer = JSON.parse(docker("version", "--format", "json")).Server;
  const dockerPath = execFileSync("which", ["docker"], { encoding: "utf8" }).trim();
  fs.mkdirSync(evidence, { recursive: true });
  const root = fs.realpathSync(fs.mkdtempSync(path.join(evidence, "work-")));
  const workspaceName = `gfq-${randomBytes(3).toString("hex")}`;
  const volumeName = `${workspaceName}-work`;
  // Dev Containers mounts the host folder at /workspaces/<its basename>; label and authority use its realpath.
  const hostFolder = path.join(root, workspaceName);
  const workspace = `/workspaces/${workspaceName}`;
  const authority = devContainerAuthority(hostFolder);
  const dockerPlatform = process.env.GRAPHFORGE_QUALIFICATION_DOCKER_PLATFORM || null;
  const extensions = path.join(hostFolder, "extensions");
  const userData = path.join(root, "user-data");
  const hostReport = path.join(hostFolder, "report.json");
  const reportPath = path.join(evidence, "report.json");
  let phase = "setup";
  const report = {
    status: "running",
    commit: process.env.GITHUB_SHA ?? null,
    vsixSha256: createHash("sha256").update(fs.readFileSync(vsix)).digest("hex"),
    requestedCore: coreVersion,
    requestedVSCode: vscodeVersion,
    runnerNodeVersion: process.version,
    uiHost: { platform: process.platform, arch: process.arch, release: os.release() },
    docker: { path: dockerPath, serverOs: dockerServer.Os, serverArch: dockerServer.Arch, serverVersion: dockerServer.Version },
    dockerPlatform,
    volumeName,
    authority,
    scope: "Remote (dev-container) packaged-extension clone/open/query/close/reopen on an admitted volume beneath a non-admitted root, with tmpfs and macOS bind-mount rejection; not useful-result or publish-back qualification",
  };
  fs.mkdirSync(path.join(hostFolder, ".devcontainer"), { recursive: true });
  fs.mkdirSync(path.join(hostFolder, "rejected-bind"));
  fs.mkdirSync(path.join(userData, "User"), { recursive: true });
  fs.copyFileSync(path.join(__dirname, "qualify-hub-clone.cjs"), path.join(hostFolder, "qualify-hub-clone.cjs"));
  writeJson(path.join(userData, "User", "settings.json"), { "dev.containers.dockerPath": dockerPath, "update.mode": "none", "extensions.autoUpdate": false, "dev.containers.logLevel": "trace" });
  writeJson(hostReport, report);
  writeJson(reportPath, report);
  let timer;
  let volumeOwned = false;
  try {
    phase = "install";
    const { downloadAndUnzipVSCode, runTests } = require("@vscode/test-electron");
    const executable = await downloadAndUnzipVSCode({ version: vscodeVersion });
    const profiles = [`--extensions-dir=${extensions}`, `--user-data-dir=${userData}`];
    const cli = process.platform === "darwin"
      ? path.resolve(path.dirname(executable), "..", "Resources", "app", "out", "cli.js")
      : path.join(path.dirname(executable), "resources", "app", "out", "cli.js");
    assert.ok(fs.statSync(cli).isFile(), "Packaged VS Code CLI script is missing");
    execFileSync(executable, [cli, ...profiles, "--install-extension", vsix, "--install-extension", "ms-vscode-remote.remote-containers", "--force", "--no-sandbox"], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "inherit",
    });
    const installedBy = (publisher, name) => fs.readdirSync(extensions).map((entry) => path.join(extensions, entry)).find((entry) => {
      const manifest = path.join(entry, "package.json");
      if (!fs.existsSync(manifest)) return false;
      const pkg = readJson(manifest);
      return pkg.publisher?.toLowerCase() === publisher.toLowerCase() && pkg.name === name;
    });
    const installed = installedBy("CurateLabsAI", "graphforge");
    const containers = installedBy("ms-vscode-remote", "remote-containers");
    assert.ok(installed, "VSIX installation did not produce the expected extension");
    assert.ok(containers, "Dev Containers extension was not installed");
    report.devContainersVersion = readJson(path.join(containers, "package.json")).version;

    phase = "container";
    assert.throws(() => docker("volume", "inspect", volumeName), "Qualification volume already exists");
    volumeOwned = true;
    writeJson(path.join(hostFolder, ".devcontainer", "devcontainer.json"), buildDevcontainerConfig({ workspaceName, volumeName, extensionDirName: path.basename(installed), coreVersion, dockerPlatform }));
    writeJson(hostReport, report);

    phase = "remote-run";
    // VS Code reuses the process env, so ELECTRON_RUN_AS_NODE (set by some shells) would make it reject every flag.
    delete process.env.ELECTRON_RUN_AS_NODE;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        // Removing the container makes the VS Code window exit, which unblocks runTests.
        try {
          for (const id of docker("ps", "-aq", "--filter", containerFilter(hostFolder)).split(/\s+/).filter(Boolean)) docker("rm", "-f", id);
        } catch (watchdogError) {
          console.warn(`Watchdog could not remove the container: ${watchdogError}`);
        }
        reject(new Error(`Dev Container qualification exceeded ${watchdogMs / 60000} minutes`));
      }, watchdogMs);
    });
    await Promise.race([timeout, runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath: remoteUri(authority, `${workspace}/extensions/${path.basename(installed)}`),
      extensionTestsPath: remoteUri(authority, `${workspace}/qualify-hub-clone.cjs`),
      launchArgs: [...profiles, `--folder-uri=${remoteUri(authority, workspace)}`],
    })]);

    const passed = readJson(hostReport);
    assert.equal(passed.status, "passed");
    assert.equal(passed.host.remoteName, "dev-container");
    assert.equal(passed.host.platform, "linux");
    writeJson(reportPath, passed);
    console.log(`Dev Container qualification passed: ${reportPath}`);
  } catch (error) {
    let failed = report;
    try { failed = readJson(hostReport); } catch { /* keep the driver's own report */ }
    failed.status = "failed";
    failed.failedPhase = phase;
    failed.error ??= error instanceof Error ? error.stack : String(error);
    writeJson(reportPath, failed);
    throw error;
  } finally {
    clearTimeout(timer);
    // Cleanup errors never mask the run result. The container outlives the window, so remove it by label.
    try {
      for (const id of docker("ps", "-aq", "--filter", containerFilter(hostFolder)).split(/\s+/).filter(Boolean)) docker("rm", "-f", id);
      // Only a volume this run proved absent before creating; never a pre-existing one.
      if (volumeOwned) try { docker("volume", "rm", volumeName); } catch { /* never created */ }
      // VS Code helper processes (e.g. the Dev Containers shutdown monitor) log up to ~10s after the window exits: remove until it stays gone.
      for (let quiet = 0, sweeps = 0; quiet < 5 && sweeps < 15; sweeps++) {
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
        await new Promise((resolve) => setTimeout(resolve, 3000));
        quiet = fs.existsSync(root) ? 0 : quiet + 1;
      }
    } catch (cleanupError) {
      console.warn(`Could not clean up Dev Container qualification (${volumeName}, ${root}): ${cleanupError}`);
    }
  }
}

if (require.main === module) {
  // Exit explicitly: after a watchdog timeout the VS Code child can still hold the event loop open.
  main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => process.exit());
}
