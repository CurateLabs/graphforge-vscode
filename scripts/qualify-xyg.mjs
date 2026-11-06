/** Real Core corpus → bundled XYG ledger, native/WASM bytes and identity agreement. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyXygCoverage } from "./xyg-coverage.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

/** Read the bytes once and verify that exact snapshot against the owning Git pin. */
export function readPinnedFixture(source, revision, relative) {
  const bytes = fs.readFileSync(path.join(source, relative));
  const pinned = execFileSync("git", ["show", `${revision}:${relative}`], { cwd: source, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(digest(bytes), digest(pinned), "Arrow fixture differs from the pinned XYG tree");
  return bytes;
}

export async function qualifyXyg(corePath, evidence, extensionRoot = root) {
  fs.mkdirSync(evidence, { recursive: true });
  // Reuse the owner's hash-bound engine-produced corpus. Do not reauthor algorithm
  // calls, schemas or dispositions here. Live contracts must agree with its versions.
  const report = { status: "running", sourceHead: process.env.GITHUB_SHA ?? null, platform: `${process.platform}-${process.arch}`, scope: "Core live catalog and real Arrow corpus; bundled native/WASM composition equivalence, not browser paint or full release acceptance" };
  const started = performance.now();
  let disposeWasm;
  try {
    const core = require(path.resolve(corePath));
    report.coreVersion = core.version();
    const forge = new core.GraphForge();
    let contracts;
    try { contracts = forge.algorithmDescriptorContracts(); }
    finally { forge.close?.(); }
    const xy = await import(pathToFileURL(path.join(extensionRoot, "dist/xyg/node/src/index.js")).href);
    const client = await import(pathToFileURL(path.join(extensionRoot, "dist/xyg/node/client/index.js")).href);
    const ledger = xy.graphforgeLedger();
    report.coverage = verifyXygCoverage(contracts, ledger);
    report.xyg = JSON.parse(fs.readFileSync(path.join(extensionRoot, "dist/xyg/provenance.json")));
    assert.equal(report.xyg.dirty, false, "Qualification requires clean pinned XYG sources");
    const source = path.join(root, "vendor/xyg");
    const fixtures = new Map();
    const readFixture = relative => {
      if (!fixtures.has(relative)) fixtures.set(relative, readPinnedFixture(source, report.xyg.revision, `tests/fixtures/graphforge/${relative}`));
      return fixtures.get(relative);
    };
    const manifestBytes = readFixture("results-0.6.0-rc.5/manifest.json");
    const manifest = JSON.parse(manifestBytes);
    const generation = JSON.parse(readFixture("results-0.6.0-rc.5/generation.json"));
    assert.equal(digest(manifestBytes), generation.manifestSha256, "XYG-owned fixture provenance");
    assert.deepEqual(Object.keys(manifest.failures), [], "Every live Core contract must produce a fixture");
    report.fixtureCoreVersion = manifest.graphforgeVersion;
    report.fixtureManifestSha256 = digest(manifestBytes);
    assert.deepEqual(manifest.contracts, contracts.map(({ verb, algorithm, resultSchemaVersion }) => ({ verb, algorithm, resultSchemaVersion })));

    const wasmPath = path.join(extensionRoot, "dist/xyg/node/client/xyg-wasm.wasm");
    const wasmBytes = fs.readFileSync(wasmPath);
    const wasmManifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, "dist/xyg/node/client/xyg-wasm.manifest.json")));
    assert.equal(digest(wasmBytes), wasmManifest.sha256, "WASM artifact digest");
    assert.equal(wasmBytes.length, wasmManifest.bytes, "WASM artifact length");
    const module = await WebAssembly.compile(wasmBytes);
    assert.deepEqual(WebAssembly.Module.imports(module), [], "WASM must not import external capabilities");
    const { exports: w } = await WebAssembly.instantiate(module, {});
    assert.equal(w.xyg_wasm_abi_version(), wasmManifest.abi_version);
    assert.equal(w.xyg_wasm_scene_version(), wasmManifest.scene_version);
    const handle = w.xyg_wasm_instance_new(256 * 1024 * 1024);
    assert.ok(handle > 0, "WASM instance allocation");
    disposeWasm = () => assert.equal(w.xyg_wasm_instance_dispose(handle), 0);
    const composeWasm = request => {
      assert.equal(w.xyg_wasm_arena_resize(handle, request.byteLength), 0, "WASM request budget");
      new Uint8Array(w.memory.buffer, w.xyg_wasm_arena_ptr(handle) >>> 0, request.byteLength).set(request);
      assert.equal(w.xyg_wasm_graphforge_compose(handle, 0, request.byteLength), 0, "WASM compose");
      return new Uint8Array(w.memory.buffer, w.xyg_wasm_output_ptr(handle) >>> 0, w.xyg_wasm_output_len(handle) >>> 0).slice();
    };
    const read = name => readFixture(`results-0.6.0-rc.5/${name}.arrow`);
    report.cases = [];
    const compare = (schema, intent, input, expectedCode) => {
      const request = xy.encodeGraphForgeRequest(input);
      assert.deepEqual(new Uint8Array(client.encodeWasmGraphForgeRequest(input)), request, "Native/browser request framing");
      const native = xy.composeGraphForgeRequest(request);
      const wasm = composeWasm(request);
      assert.equal(Buffer.compare(Buffer.from(native), Buffer.from(wasm)), 0, `${schema}/${intent}: native/WASM documents differ`);
      if (expectedCode) {
        assert.throws(() => xy.decodeGraphForgeDocument(native), error => error.code === expectedCode);
        assert.throws(() => client.decodeWasmGraphForgeDocument(wasm), error => error.code === expectedCode);
      } else {
        const c = xy.decodeGraphForgeDocument(native);
        const browser = client.decodeWasmGraphForgeDocument(wasm);
        if (c.kind === "graph") {
          assert.deepEqual(browser.nodeUuid, c.nodes.uuid);
          assert.deepEqual(browser.edgeUuid, c.edges.uuid);
          for (let i = 0; i < c.nodes.count; i++)
            assert.deepEqual(browser.identifyStableId((1n << 32n) + BigInt(i)).layers, c.identify("node", i).layers);
          for (let i = 0; i < c.edges.count; i++)
            assert.deepEqual(browser.identifyStableId(BigInt(i) + 1n).layers, c.identify("edge", i).layers);
        }
        if (input.layers?.length) assert.equal(c.layers[0].schema, schema);
      }
      report.cases.push({ schema, intent, status: expectedCode ?? "passed", requestBytes: request.byteLength, documentBytes: native.byteLength, documentSha256: digest(native) });
    };
    for (const { algorithm } of [...contracts, { algorithm: "find" }]) {
      const row = algorithm === "find" ? ledger.find(row => row.schema === "search") : ledger.find(row => row.algorithms.includes(algorithm));
      assert.ok(row, `${algorithm} needs an XYG disposition`);
      const base = manifest.bases[manifest.fixtures[algorithm].base];
      for (const intent of row.intents) {
        const input = { base: { tables: [read(base.nodes), read(base.edges)], generation: base.generation }, layers: [{ result: read(algorithm), resultId: algorithm, intent, generation: base.generation }] };
        compare(row.schema, intent, input, intent === "embedding-coordinates" ? "GF_COMPOSE_COORDINATES_REQUIRED" : undefined);
        if (["pagerank", "node_similarity", "dijkstra"].includes(algorithm))
          compare(row.schema, `${intent}+scene`, { ...input, render: { width: 480, height: 320 } });
      }
    }
    const base = manifest.bases.cyclic;
    for (const name of ["cypher-nodes", "cypher-edges", "cypher-paths"])
      compare("entity_graph", name, { base: { tables: [read(name)], generation: base.generation }, render: { width: 480, height: 320 } });
    for (const name of ["cypher-scalars", "schema"])
      compare("table-only", name, { base: { tables: [read(name)], generation: base.generation } }, "GF_BASE_SCHEMA");
    compare("node-score", "unsupported-schema-version", {
      base: { tables: [read(base.nodes), read(base.edges)], generation: base.generation },
      layers: [{ result: readFixture("derived/pagerank-schema-v2.arrow"), intent: "graph", generation: base.generation }],
    }, "GF_RESULT_SCHEMA_VERSION");
    compare("embedding", "explicit-coordinates", { layers: [{
      result: readFixture("results/node2vec.arrow"), intent: "embedding-coordinates",
      coordinates: readFixture("derived/node2vec-coordinates.arrow"),
    }] });
    compare("node-score", "graph", { base: { tables: [read(base.nodes), read(base.edges)], generation: base.generation }, layers: [{ result: read("pagerank"), intent: "graph", generation: manifest.bases.dag.generation }] }, "GF_COMPOSE_GENERATION_STALE");
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.code = error.code ?? "XYG_QUALIFICATION_FAILED";
    // Assertions contain only schema names/counts; avoid serializing native errors or source content.
    if (error.code === "ERR_ASSERTION") report.assertion = error.message.split("\n")[0];
    throw error;
  } finally {
    disposeWasm?.();
    report.elapsedMs = Math.round(performance.now() - started);
    report.peakRssBytes = process.resourceUsage().maxRSS * 1024;
    fs.writeFileSync(path.join(evidence, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || !process.argv[3]) throw new Error("Usage: qualify-xyg.mjs <Core package directory> <evidence directory> [installed extension directory]");
  qualifyXyg(process.argv[2], path.resolve(process.argv[3]), process.argv[4] ? path.resolve(process.argv[4]) : root)
    .then(report => console.log(`XYG qualification passed: ${report.coverage.algorithms} live contracts, ${report.cases.length} native/WASM cases`))
    .catch(error => { console.error(`XYG qualification failed: ${error.code ?? "XYG_QUALIFICATION_FAILED"}`); process.exitCode = 1; });
}
