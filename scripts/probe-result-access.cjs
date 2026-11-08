// Opt-in, one-off Arrow access probe (NFR-12); never part of CI. See TESTING.md.
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { tableFromArrays, tableToIPC } = require("apache-arrow");

assert.ok(process.argv.length === 3 && global.gc,
  "Usage: node --expose-gc scripts/probe-result-access.cjs <report.json>");
const root = path.resolve(__dirname, "..");
const reportPath = path.resolve(process.argv[2]);
const sources = ["arrowCodec.ts", "resultRows.ts"];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const inputs = [...sources, "types.ts"];
const capturedSources = Object.fromEntries(inputs.map(file =>
  [file, fs.readFileSync(path.join(root, "src/session", file))]));
const sourceSha256 = Object.fromEntries(inputs.map(file => [file, hash(capturedSources[file])]));
const sourceHashes = () => Object.fromEntries(inputs.map(file =>
  [file, hash(fs.readFileSync(path.join(root, "src/session", file)))]));
const cache = path.join(root, "node_modules/.cache");
fs.mkdirSync(cache, { recursive: true });
const work = fs.mkdtempSync(path.join(cache, "gf-result-access-"));
const snapshot = path.join(work, "src");
const library = path.join(work, "lib");
try {
  fs.mkdirSync(snapshot);
  for (const file of inputs) fs.writeFileSync(path.join(snapshot, file), capturedSources[file]);
  // Own the compilation, so callers cannot supply a stale artifact with fresh
  // source hashes. The private directory also resolves this checkout's Arrow.
  const compiler = path.join(path.dirname(require.resolve("typescript/package.json")), "bin/tsc");
  execFileSync(process.execPath, [compiler, "--ignoreConfig", "--outDir", library,
    "--module", "commonjs", "--target", "es2022", "--types", "node",
    "--esModuleInterop", "--skipLibCheck", ...sources.map(file => path.join(snapshot, file))],
  { cwd: root, stdio: "inherit" });
  assert.deepEqual(sourceHashes(), sourceSha256, "Sources changed during probe compilation; rerun the probe.");
  const compiledSha256 = Object.fromEntries(sources.map(file => {
    const output = file.replace(/\.ts$/, ".js");
    return [output, hash(fs.readFileSync(path.join(library, output)))];
  }));
  const { decodeTable } = require(path.join(library, "arrowCodec.js"));
  const { queryResultPage } = require(path.join(library, "resultRows.js"));
  const ipc = Buffer.from(tableToIPC(tableFromArrays(Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => ["value" + i, Float64Array.from({ length: 100000 }, (_, row) => row + i)]),
  ))));
  global.gc();
  const before = process.memoryUsage();
  const start = performance.now();
  const result = decodeTable(ipc);
  const decoded = performance.now();
  const page = queryResultPage(result);
  const finished = performance.now();
  const after = process.memoryUsage();
  assert.equal(result.ipc, ipc);
  assert.equal(result.rowCount, 100000);
  assert.equal(page.rows.length, 500);
  assert.equal(page.nextOffset, 500);
  assert.equal(queryResultPage(result, 99500).nextOffset, undefined);
  assert.deepEqual(sourceHashes(), sourceSha256, "Sources changed during measurement; rerun the probe.");
  const report = {
    sourceSha256, compiledSha256, typescript: require("typescript/package.json").version,
    node: process.version, platform: process.platform + "-" + process.arch,
    scope: "One opt-in synthetic numerical Arrow access probe; no layout/paint/interaction/scale release claim",
    rows: result.rowCount, columns: result.columns.length, ipcBytes: ipc.byteLength,
    returnedRows: page.rows.length, returnedJsonBytes: Buffer.byteLength(JSON.stringify(page)),
    decodeMs: decoded - start, firstPageMs: finished - decoded,
    heapDeltaBytes: after.heapUsed - before.heapUsed, rssDeltaBytes: after.rss - before.rss,
    originalIpcIdentity: true,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
