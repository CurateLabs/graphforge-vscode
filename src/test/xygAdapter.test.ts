import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { decodeTable } from "../session/arrowCodec";
import {
  composeInput,
  importEsm,
  isXygResultLayer,
  ledgerEntryFor,
  loadXygNative,
  pickRows,
  rowIdentities,
  selectableIntents,
  toXygError,
  XYG_EXPECTED_VERSIONS,
  type XygComposeInput,
  type XygGraphForgeApi,
  type XygIntent,
} from "../session/xygAdapter";

/**
 * Real XYG hosts on real GraphForge output: the native core (vendored
 * candidate package) and the direct-browser WASM module, run in Node.
 * Fixtures: scripts/generate-result-fixtures.cjs.
 */
const FIXTURES = path.resolve(__dirname, "fixtures", "graphforge-results");
const RESULT_SCHEMAS_DOC = path.resolve(__dirname, "..", "..", "docs", "engineering", "RESULT_SCHEMAS.md");
const GENERATION = "01890000-0000-7000-8000-000000000001";
const OTHER_GENERATION = "01890000-0000-7000-8000-000000000002";
const RESULT_ID = "01890000-0000-7000-8000-0000000000aa";

interface Manifest {
  contracts: { verb: string; algorithm: string }[];
  fixtures: Record<string, { verb: string; algorithm?: string; base?: string }>;
}
const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURES, "manifest.json"), "utf8")) as Manifest;

function bytes(name: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(FIXTURES, `${name}.arrow`)));
}

function metadata(name: string): Record<string, string> {
  return decodeTable(Buffer.from(bytes(name))).schema!.metadata;
}

function inputFor(name: string, intent: XygIntent, generation = GENERATION): XygComposeInput {
  const base = manifest.fixtures[name].base;
  return composeInput({
    result: bytes(name),
    intent,
    resultId: RESULT_ID,
    generation,
    base:
      intent === "graph" && base
        ? { tables: [bytes(`base-${base}-nodes`), bytes(`base-${base}-edges`)], generation: GENERATION }
        : undefined,
  });
}

const layerFixtures = [...manifest.contracts.map((c) => c.algorithm), "find"];

/** Minimal Node driver for the real `xyg-wasm.wasm` (no imports, arena ABI). */
async function wasmComposer(): Promise<(request: Uint8Array) => Uint8Array> {
  const wasmPath = createRequire(__filename).resolve("@curatelabs/xyg/xyg-wasm.wasm");
  // The extension's tsconfig has no DOM lib; WebAssembly is a Node global.
  const wasm = (globalThis as unknown as {
    WebAssembly: { instantiate(bytes: Uint8Array, imports: object): Promise<{ instance: { exports: unknown } }> };
  }).WebAssembly;
  const { instance } = await wasm.instantiate(fs.readFileSync(wasmPath), {});
  const w = instance.exports as Record<string, (...args: number[]) => number> & { memory: { buffer: ArrayBuffer } };
  assert.equal(w.xyg_wasm_abi_version(), XYG_EXPECTED_VERSIONS.wasmAbi);
  const handle = w.xyg_wasm_instance_new(64 << 20) >>> 0;
  assert.ok(handle, "WASM instance");
  return (request) => {
    assert.equal(w.xyg_wasm_arena_resize(handle, request.byteLength), 0);
    const ptr = w.xyg_wasm_arena_ptr(handle) >>> 0;
    new Uint8Array(w.memory.buffer, ptr, request.byteLength).set(request);
    assert.equal(w.xyg_wasm_graphforge_compose(handle, 0, request.byteLength), 0);
    const out = w.xyg_wasm_output_ptr(handle) >>> 0;
    const len = w.xyg_wasm_output_len(handle) >>> 0;
    return new Uint8Array(w.memory.buffer, out, len).slice();
  };
}

suite("XYG adapter (#80)", () => {
  let api: XygGraphForgeApi;

  suiteSetup(async () => {
    const loaded = await loadXygNative();
    assert.ok(loaded.ok, loaded.ok ? "" : `${loaded.code}: ${loaded.message}`);
    api = loaded.api;
    assert.equal(loaded.abiVersion, XYG_EXPECTED_VERSIONS.nativeAbi);
  });

  test("XYG's Rust ledger covers every GraphForge contract and agrees with RESULT_SCHEMAS.md", () => {
    const ledger = api.graphforgeLedger();
    const doc = fs.readFileSync(RESULT_SCHEMAS_DOC, "utf8");
    const documented = new Map<string, string>();
    for (const line of doc.split("\n")) {
      const cells = line.split("|").map((cell) => cell.trim());
      if (cells.length < 6 || !/^`[a-z-]+`$/.test(cells[1])) continue;
      const disposition = cells[2].split(" ")[0];
      for (const name of cells[4].replace(/\([^)]*alias ([a-z_]+)\)/g, ", $1").split(",")) {
        const algorithm = name.trim();
        if (/^[a-z0-9_]+$/.test(algorithm)) documented.set(algorithm, disposition);
      }
    }
    for (const { algorithm } of manifest.contracts) {
      const entry = ledger.find((e) => e.algorithms.includes(algorithm));
      assert.ok(entry, `XYG ledger has no entry for ${algorithm}`);
      assert.equal(entry.version, 1);
      assert.equal(documented.get(algorithm), entry.disposition, `RESULT_SCHEMAS.md disposition for ${algorithm}`);
    }
  });

  test("every algorithm and find result composes for each selectable intent", () => {
    const ledger = api.graphforgeLedger();
    let graphs = 0;
    for (const name of layerFixtures) {
      const meta = metadata(name);
      assert.ok(isXygResultLayer(meta), name);
      const intents = selectableIntents(ledgerEntryFor(ledger, meta));
      assert.ok(intents.length > 0, `${name} has no selectable intent`);
      assert.ok(!intents.includes("embedding-coordinates"), "coordinates are never invented");
      for (const intent of intents) {
        const composition = api.composeGraphForge(inputFor(name, intent));
        const diagnostics = composition.diagnostics();
        assert.equal(diagnostics.layers[0].intent, intent, `${name}:${intent}`);
        assert.equal(composition.layers[0].resultId, RESULT_ID);
        if (composition.kind === "table") {
          assert.match(api.graphforgeTableHtml(composition), /<table/);
        } else {
          const payload = api.graphforgeWebviewPayload(composition, { width: 480, height: 320, theme: "dark" });
          assert.ok(payload.buffer.byteLength > 0, `${name}:${intent} paint buffer`);
          graphs += composition.kind === "graph" ? 1 : 0;
        }
      }
    }
    assert.equal(graphs, 79);
  });

  test("composed identities and rows round-trip to the exact result rows", () => {
    const result = decodeTable(Buffer.from(bytes("pagerank")));
    const composition = api.composeGraphForge(inputFor("pagerank", "graph"));
    const rows = rowIdentities(composition, RESULT_ID);
    assert.equal(rows.size, result.rowCount);
    for (const [row, uuids] of rows) {
      assert.deepEqual(uuids, [result.rows[row].node_uuid]);
      const index = composition.select(uuids).nodes[0];
      assert.deepEqual(pickRows(composition.identify("node", index), RESULT_ID), [row]);
      assert.deepEqual(pickRows(composition.identify("node", index), "another-result"), []);
    }
  });

  test("ordered paths and derived edges link rows through persisted UUIDs or endpoints", () => {
    const yens = decodeTable(Buffer.from(bytes("yens")));
    const paths = rowIdentities(api.composeGraphForge(inputFor("yens", "graph")), RESULT_ID);
    for (const [row, uuids] of paths) {
      for (const node of yens.rows[row].path as string[]) assert.ok(uuids.includes(node), "path node selected");
    }
    const similarity = decodeTable(Buffer.from(bytes("node_similarity")));
    const derived = rowIdentities(api.composeGraphForge(inputFor("node_similarity", "graph")), RESULT_ID);
    for (const [row, uuids] of derived) {
      assert.ok(uuids.includes(String(similarity.rows[row].node1_uuid)));
      assert.ok(uuids.includes(String(similarity.rows[row].node2_uuid)));
    }
  });

  test("a stale or unverifiable generation fails with XYG's code and a next action", () => {
    assert.throws(
      () => api.composeGraphForge(inputFor("pagerank", "graph", OTHER_GENERATION)),
      (err: unknown) => {
        const error = toXygError(err);
        return error.code === "GF_COMPOSE_GENERATION_STALE" && /Re-run/.test(error.nextAction);
      },
    );
    const missing = inputFor("pagerank", "graph");
    delete missing.layers[0].generation;
    assert.throws(() => api.composeGraphForge(missing), (err: unknown) => toXygError(err).code === "GF_COMPOSE_GENERATION_MISSING");
  });

  test("native and direct-browser WASM hosts compose byte-identical documents", async () => {
    const compose = await wasmComposer();
    const browser = (await importEsm("@curatelabs/xyg")) as {
      encodeWasmGraphForgeRequest(input: XygComposeInput): Uint8Array;
    };
    const ledger = api.graphforgeLedger();
    for (const name of layerFixtures) {
      for (const intent of selectableIntents(ledgerEntryFor(ledger, metadata(name)))) {
        const input = inputFor(name, intent);
        const request = api.encodeGraphForgeRequest(input);
        assert.deepEqual(Buffer.from(browser.encodeWasmGraphForgeRequest(input)), Buffer.from(request), `${name}:${intent} request`);
        assert.deepEqual(Buffer.from(compose(request)), Buffer.from(api.composeGraphForgeRequest(request)), `${name}:${intent} document`);
      }
    }
  });

  test("host loading failures surface stable codes, never a fallback", async () => {
    const missing = await loadXygNative(async () => { throw new Error("not found"); });
    assert.deepEqual([missing.ok, !missing.ok && missing.code], [false, "XYG_NODE_IMPORT_FAILED"]);
    const unsupported = await loadXygNative(async () => ({
      loadXygNode: async () => ({ ok: false, code: "XYG_NATIVE_UNSUPPORTED_PLATFORM", message: "no core" }),
    }));
    assert.deepEqual([unsupported.ok, !unsupported.ok && unsupported.code], [false, "XYG_NATIVE_UNSUPPORTED_PLATFORM"]);
    assert.match(toXygError(unsupported).nextAction, /wasm/);
    const mismatch = await loadXygNative(async () => ({ loadXygNode: async () => ({ ok: true, abiVersion: 1 }) }));
    assert.deepEqual([mismatch.ok, !mismatch.ok && mismatch.code], [false, "XYG_NATIVE_ABI_MISMATCH"]);
  });
});
