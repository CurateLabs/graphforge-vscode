/* Packaged extension storage qualification (#94), using the existing EDH runner. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");

// VS Code loads this same file as its test entrypoint. No source extension is loaded.
exports.run = async function run() {
  const vscode = require("vscode");
  const root = process.env.GRAPHFORGE_QUALIFICATION_WORK;
  const reportPath = process.env.GRAPHFORGE_QUALIFICATION_REPORT;
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const command = (id, args) => vscode.commands.executeCommand(id, args);
  try {
    const config = vscode.workspace.getConfiguration("graphforge");
    const binding = path.join(root, "binding", "node_modules", "@curatelabs", "graphforge");
    await config.update("nativeModulePath", binding, vscode.ConfigurationTarget.Global);
    await config.update("runtime", "node", vscode.ConfigurationTarget.Global);
    const extension = vscode.extensions.getExtension("CurateLabsAI.graphforge");
    assert.ok(extension, "Installed GraphForge extension was not found");
    assert.equal(fs.realpathSync(extension.extensionPath), fs.realpathSync(process.env.GRAPHFORGE_QUALIFICATION_EXTENSION));
    await extension.activate();
    report.extensionVersion = extension.packageJSON.version;
    report.qualifiedCore = extension.packageJSON.graphforge.qualifiedCore.range;
    report.coreVersion = require(binding).version();
    assert.equal(report.coreVersion, process.env.GRAPHFORGE_QUALIFICATION_CORE);
    report.vscodeVersion = vscode.version;
    report.host = { platform: process.platform, arch: process.arch, release: os.release(), remoteName: vscode.env.remoteName ?? null };
    assert.equal(vscode.env.remoteName, undefined, "This lane qualifies a local extension host");

    const destination = path.join(root, "project");
    if (process.platform === "linux") {
      report.filesystems = { root: fs.statfsSync("/").type, destinationParent: fs.statfsSync(root).type };
      // /dev/shm is an actual unsupported tmpfs; do not simulate Core admission.
      assert.equal(fs.statfsSync("/dev/shm").type, 0x01021994);
      const rejectedDestination = path.join("/dev/shm", `graphforge-qualification-${process.pid}`);
      assert.equal(fs.existsSync(rejectedDestination), false);
      const rejected = await command("graphforge.cloneFromHub", { repository: "openalex/openalex", destination: rejectedDestination });
      assert.equal(rejected.code, "GF_UNSUPPORTED_FILESYSTEM", JSON.stringify(rejected));
      assert.match(rejected.error, /GF_UNSUPPORTED_FILESYSTEM/);
      assert.match(rejected.nextAction, /ext4, XFS, or Btrfs/);
      assert.equal(fs.existsSync(rejectedDestination), false, "Rejected clone left a destination");
      report.unsupportedStorage = { code: rejected.code, error: rejected.error, nextAction: rejected.nextAction, destinationExists: false };
    }

    const cloned = await command("graphforge.cloneFromHub", { repository: "openalex/openalex", destination, open: true });
    assert.equal(cloned.opened, true, JSON.stringify(cloned));
    assert.ok(cloned.immutableVersion && cloned.packageDigest && cloned.generationUuid, "Clone identity is incomplete");
    report.clone = cloned;
    const query = () => command("graphforge.runQuery", { cypher: "MATCH (n) RETURN count(n) AS nodes", resultName: "storage-qualification" });
    const first = await query();
    assert.equal(first.rowCount, 1, JSON.stringify(first));
    assert.match(String(first.rows?.[0]?.nodes), /^\d+$/);
    assert.equal((await command("graphforge.closeProject")).closed, true);
    const reopened = await command("graphforge.openProject", destination);
    assert.equal(reopened.path, destination, JSON.stringify(reopened));
    const second = await query();
    assert.equal(second.rowCount, 1, JSON.stringify(second));
    assert.deepEqual(second.rows, first.rows, "Result changed after durable reopen");
    report.nodeCount = String(first.rows[0].nodes);
    report.reopenedNodeCount = String(second.rows[0].nodes);
    assert.equal((await command("graphforge.closeProject")).closed, true);
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.error = error instanceof Error ? error.stack : String(error);
    throw error;
  } finally {
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
};

async function main() {
  const vsix = path.resolve(process.argv[2] ?? "graphforge-ci.vsix");
  const evidence = path.resolve(process.argv[3] ?? "hub-clone-evidence");
  const coreVersion = "0.6.0-rc.5";
  const vscodeVersion = "1.142.0";
  assert.ok(fs.statSync(vsix).isFile(), "Pass an existing packaged VSIX");
  assert.ok(process.env.npm_execpath, "Run through npm run qualify:hub-clone -- <vsix> <evidence-directory>");
  fs.mkdirSync(evidence, { recursive: true });
  const root = fs.mkdtempSync(path.join(evidence, "work-"));
  const reportPath = path.join(evidence, "report.json");
  const report = {
    status: "running",
    commit: process.env.GITHUB_SHA ?? null,
    vsixSha256: createHash("sha256").update(fs.readFileSync(vsix)).digest("hex"),
    requestedCore: coreVersion,
    requestedVSCode: vscodeVersion,
    scope: "Local packaged-extension clone/open/query/close/reopen; not useful-result, remote-host, or publish-back qualification",
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  try {
    // Install the real public candidate outside the source checkout. No saved dependency edits.
    execFileSync(process.execPath, [process.env.npm_execpath, "install", "--prefix", path.join(root, "binding"), "--no-package-lock", "--no-save", "--no-audit", "--no-fund", `@curatelabs/graphforge@${coreVersion}`], { stdio: "inherit" });
    const { downloadAndUnzipVSCode, runTests } = require("@vscode/test-electron");
    const downloadOptions = { version: vscodeVersion };
    const executable = await downloadAndUnzipVSCode(downloadOptions);
    const extensions = path.join(root, "extensions");
    const userData = path.join(root, "user-data");
    const profiles = [`--extensions-dir=${extensions}`, `--user-data-dir=${userData}`];
    // Invoke Electron's CLI script directly: Windows code.cmd goes through a shell
    // in the upstream helper, which splits paths containing spaces/metacharacters.
    const cli = process.platform === "darwin"
      ? path.resolve(path.dirname(executable), "..", "Resources", "app", "out", "cli.js")
      : path.join(path.dirname(executable), "resources", "app", "out", "cli.js");
    execFileSync(executable, [cli, ...profiles, "--install-extension", vsix, "--force", "--no-sandbox"], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "inherit",
    });
    const installed = fs.readdirSync(extensions).map((entry) => path.join(extensions, entry)).find((entry) => {
      const manifest = path.join(entry, "package.json");
      if (!fs.existsSync(manifest)) return false;
      const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
      return pkg.publisher === "CurateLabsAI" && pkg.name === "graphforge";
    });
    assert.ok(installed, "VSIX installation did not produce the expected extension");
    await runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath: installed,
      extensionTestsPath: __filename,
      launchArgs: profiles,
      extensionTestsEnv: {
        GRAPHFORGE_QUALIFICATION_WORK: root,
        GRAPHFORGE_QUALIFICATION_REPORT: reportPath,
        GRAPHFORGE_QUALIFICATION_CORE: coreVersion,
        GRAPHFORGE_QUALIFICATION_EXTENSION: installed,
      },
    });
    assert.equal(JSON.parse(fs.readFileSync(reportPath, "utf8")).status, "passed");
    console.log(`Hub clone qualification passed: ${reportPath}`);
  } catch (error) {
    const failed = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    failed.status = "failed";
    failed.error ??= error instanceof Error ? error.stack : String(error);
    fs.writeFileSync(reportPath, `${JSON.stringify(failed, null, 2)}\n`);
    throw error;
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
