/* Core-only native arm64 reproduction; no VS Code or extension networking. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");

const [bindingPath, repository, parent, reportPath] = process.argv.slice(2);
assert.ok(bindingPath && repository && parent && reportPath,
  "Usage: node scripts/probe-core-hub-clone.cjs <installed-binding> <repository> <parent> <report.json>");
const binding = path.resolve(bindingPath);
const destination = path.join(parent, "project");
const report = {
  status: "running",
  commit: process.env.GITHUB_SHA ?? null,
  host: { platform: process.platform, arch: process.arch, release: os.release(), node: process.version, cpus: os.cpus()[0]?.model },
  repository,
  destination,
};
try {
  assert.equal(process.platform, "linux");
  assert.equal(process.arch, "arm64", "Run on real Linux arm64, without x64 emulation");
  report.filesystem = fs.statfsSync(parent).type;
  assert.equal(fs.existsSync(destination), false, "Probe requires a fresh destination");
  const core = require(binding);
  report.coreVersion = core.version();
  const addon = Object.keys(require.cache).find((file) => file.endsWith(".node") && file.includes("graphforge"));
  assert.ok(addon, "Loaded Core native addon was not found");
  report.addon = { name: path.basename(addon), sha256: createHash("sha256").update(fs.readFileSync(addon)).digest("hex") };
  const result = core.runCli(["clone", repository, destination, "--json"]);
  report.result = { exitCode: result.exitCode, stdout: result.stdout.toString("utf8"), stderr: result.stderr.toString("utf8") };
  report.destinationExists = fs.existsSync(destination);
  assert.equal(report.result.exitCode, 0, JSON.stringify(report.result));
  const receipt = JSON.parse(report.result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(receipt.contract, "graphforge-hub-clone/1");
  assert.ok(receipt.package_digest && receipt.generation_uuid && receipt.immutable_version, "Clone receipt identity is incomplete");
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
