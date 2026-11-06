/* Exercise the installed VSIX and its bundled Core using an isolated profile. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { resolveWindowsCli } = require("./qualify-hub-clone.cjs");

exports.run = async () => {
  const vscode = require("vscode");
  const reportPath = process.env.GRAPHFORGE_XYG_REPORT;
  const report = JSON.parse(fs.readFileSync(reportPath));
  try {
    const extension = vscode.extensions.getExtension("CurateLabsAI.graphforge");
    assert.ok(extension, "Installed extension is missing");
    assert.equal(fs.realpathSync(extension.extensionPath), fs.realpathSync(process.env.GRAPHFORGE_XYG_INSTALLED));
    assert.equal(vscode.env.remoteName ?? null, null, "This runner proves the local desktop extension host");
    report.extensionVersion = extension.packageJSON.version;
    report.vscodeVersion = vscode.version;
    report.host = { platform: process.platform, arch: process.arch, nodeVersion: process.version, remoteName: vscode.env.remoteName ?? null };
    const xyPath = path.join(extension.extensionPath, "dist/xyg");
    report.xyg = JSON.parse(fs.readFileSync(path.join(xyPath, "provenance.json")));
    assert.equal(report.xyg.platform, `${process.platform}-${process.arch}`);
    assert.equal(report.xyg.dirty, false);
    report.coreVersion = require(process.env.GRAPHFORGE_NATIVE_MODULE).version();
    assert.equal(report.coreVersion, report.requestedCore);
    await extension.activate();
    const Mocha = require("mocha");
    report.tests = [];
    const mocha = new Mocha({ ui: "tdd", timeout: 600000, reporter: function SafeReporter(runner) {
      runner.on("pass", test => report.tests.push({ name: test.fullTitle(), status: "passed", durationMs: test.duration }));
      runner.on("pending", test => report.tests.push({ name: test.fullTitle(), status: "skipped" }));
      runner.on("fail", (test, error) => report.tests.push({ name: test.fullTitle(), status: "failed", code: error.code ?? "XYG_TEST_FAILED" }));
    } });
    mocha.addFile(path.join(process.env.GRAPHFORGE_XYG_SOURCE, "dist/test/quickstart.e2e.test.js"));
    const failures = await new Promise(resolve => mocha.run(resolve));
    assert.equal(failures, 0, "Installed XYG matrix failed; see value-free report");
    assert.ok(report.tests.length > 0 && report.tests.every(test => test.status === "passed"), "Qualification cannot skip tests");
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.code = error.code ?? "XYG_INSTALLED_QUALIFICATION_FAILED";
    // The EDH harness prints thrown errors. Never forward a result-bearing assertion.
    throw new Error(`XYG installed qualification failed: ${report.code}`);
  } finally {
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
};

async function main() {
  const [vsixArg, evidenceArg] = process.argv.slice(2);
  assert.ok(vsixArg && evidenceArg, "Usage: qualify-installed-xyg.cjs <VSIX> <evidence directory>");
  const vsix = path.resolve(vsixArg), evidence = path.resolve(evidenceArg);
  fs.mkdirSync(evidence, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "gf-xyg-installed-"));
  const reportPath = path.join(evidence, "installed.json");
  const report = {
    status: "running", sourceHead: process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    vsixSha256: createHash("sha256").update(fs.readFileSync(vsix)).digest("hex"), requestedCore: "0.6.0-rc.7",
    scope: "Clean installed local desktop VSIX: real Core, Arrow persistence, canonical edit/reopen, four views, exports and explicit temporal limit, themes, reduced motion, resize, retained views; not a screen-reader certification or remote-host proof",
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  try {
    const { downloadAndUnzipVSCode, runTests } = require("@vscode/test-electron");
    const executable = process.env.GRAPHFORGE_VSCODE_EXECUTABLE ?? await downloadAndUnzipVSCode({ version: "1.142.0" });
    const cli = process.platform === "win32"
      ? resolveWindowsCli(executable, fs.readFileSync(path.join(path.dirname(executable), "bin/code.cmd"), "utf8"))
      : process.platform === "darwin"
        ? path.resolve(path.dirname(executable), "../Resources/app/out/cli.js")
        : path.join(path.dirname(executable), "resources/app/out/cli.js");
    const profiles = ["--extensions-dir", path.join(work, "extensions"), "--user-data-dir", path.join(work, "profile")];
    execFileSync(executable, [cli, ...profiles, "--install-extension", vsix, "--force", "--no-sandbox"], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: "pipe" });
    const installed = fs.readdirSync(path.join(work, "extensions")).map(name => path.join(work, "extensions", name)).find(dir => {
      const pkg = path.join(dir, "package.json");
      if (!fs.existsSync(pkg)) return false;
      const manifest = JSON.parse(fs.readFileSync(pkg));
      return manifest.publisher === "CurateLabsAI" && manifest.name === "graphforge";
    });
    assert.ok(installed, "Expected installed GraphForge package");
    const core = path.join(installed, "dist/core/node_modules/@curatelabs/graphforge");
    const settings = path.join(work, "profile/User");
    fs.mkdirSync(settings, { recursive: true });
    fs.writeFileSync(path.join(settings, "settings.json"), JSON.stringify({ "graphforge.runtime": "node", "update.mode": "none", "chat.disableAIFeatures": true }));
    // Independently exercise the exact installed cohort, not a source-only native library.
    const { qualifyXyg } = await import("./qualify-xyg.mjs");
    await qualifyXyg(core, evidence, installed);
    await runTests({
      vscodeExecutablePath: executable, extensionDevelopmentPath: installed, extensionTestsPath: __filename,
      launchArgs: [...profiles, "--no-sandbox", "--sync", "off", "--disable-extension", "GitHub.copilot-chat", "--skip-welcome", "--skip-release-notes", "--force-prefers-reduced-motion", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"],
      extensionTestsEnv: { ELECTRON_RUN_AS_NODE: undefined, GRAPHFORGE_NATIVE_MODULE: core, GRAPHFORGE_REQUIRE_NATIVE: "1", GRAPHFORGE_REDUCED_MOTION_REQUIRED: "1", GRAPHFORGE_XYG_INSTALLED: installed, GRAPHFORGE_XYG_SOURCE: process.cwd(), GRAPHFORGE_XYG_REPORT: reportPath, GRAPHFORGE_XYG_SCENARIOS: path.join(evidence, "scenarios.json") },
    });
    assert.equal(JSON.parse(fs.readFileSync(reportPath)).status, "passed");
    console.log(`Installed XYG qualification passed (${process.platform}-${process.arch})`);
  } catch (error) {
    const failed = JSON.parse(fs.readFileSync(reportPath));
    failed.status = "failed";
    failed.code ??= error.code ?? "XYG_INSTALLED_QUALIFICATION_FAILED";
    fs.writeFileSync(reportPath, `${JSON.stringify(failed, null, 2)}\n`);
    throw new Error(`Installed XYG qualification failed: ${failed.code}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
