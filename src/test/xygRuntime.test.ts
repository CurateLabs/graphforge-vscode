import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  sameArrowResult,
  graphInput,
  numericColumn,
  loadXyg,
  composeChart,
  composeMap,
  validateVisualization,
  resultEntitySelection,
  resultRowsFromXygPick,
  resultEntitiesFromXygRow,
  requireVisualComposition,
  graphResultId,
  resultRowsFromXygChart,
} from "../webview/xygRuntime";
import {
  createResultGraphSpec,
  isVisualizationSpec,
  type ProjectVisualizationSpec,
} from "../session/visualizationRegistry";
import { decodeTable } from "../session/arrowCodec";
import { tableFromArrays, tableToIPC } from "apache-arrow";

const root = path.resolve(__dirname, "../..");
suite("XYG ownership and native composition", () => {
  test("table-only composition fails with an action instead of starting graph layout", () => {
    assert.throws(() => requireVisualComposition({ kind: "table" }), (error: any) => error.code === "XYG_TABLE_ONLY" && /Open the source result in Results/.test(error.message));
    requireVisualComposition({ kind: "parallel-coordinates" });
  });
  test("explicit analytical charts require no invented base graph", async () => {
    const xy = await loadXyg(root);
    const fixture = path.join(root, "vendor/xyg/tests/fixtures/graphforge/results-0.6.0-rc.5");
    for (const [name, intent] of [["node2vec", "parallel-coordinates"], ["conductance", "bar-chart"]] as const) {
      const result = decodeTable(fs.readFileSync(path.join(fixture, `${name}.arrow`)));
      const spec = createResultGraphSpec({ name, result: `results/${name}.json`, intent });
      const input = graphInput(spec, result);
      assert.equal(input.base, undefined);
      assert.ok("layers" in input);
      assert.equal(input.layers[0].resultId, graphResultId(spec, result));
      const c = xy.composeGraphForge({ ...input, layers: input.layers.map(layer => ({ ...layer, rows: Array.from({ length: result.rowCount }, (_, i) => result.rowCount - 1 - i) })) });
      assert.equal(c.kind, intent);
      const fig = xy.graphforgeChart(c, { width: 480, height: 320 });
      assert.ok(fig.buildPayload().buffers.byteLength > 0);
      const index = intent === "parallel-coordinates" ? c.vectors.dimensions - 1 : 1;
      const rows = intent === "parallel-coordinates" ? c.vectors.resultRows : c.chart.resultRows;
      assert.deepEqual(resultRowsFromXygChart(fig, c, { trace: 0, index }, result.rowCount), [rows[1]]);
      assert.deepEqual(resultRowsFromXygChart(fig, c, { trace: 999, index }, result.rowCount), []);
    }
  });
  test("derived and aggregate picks use bounded native result provenance", () => {
    const derived = { uuid: null, layers: [{ resultId: "results/a.json", row: 4 }, { resultId: "results/b.json", row: 2 }] };
    assert.deepEqual(resultRowsFromXygPick(derived, "results/a.json", 10), [4]);
    assert.deepEqual(resultRowsFromXygPick({ edges: [derived, derived, { layers: [{ resultId: "results/a.json", row: -1 }, { resultId: "results/a.json", row: 10 }] }] }, "results/a.json", 10), [4]);
    assert.deepEqual(resultRowsFromXygPick(derived, "results/other.json", 10), []);
  });
  test("analytical table rows select native member identities without inventing derived UUIDs", async () => {
    const xy = await loadXyg(root);
    const fixture = path.join(root, "vendor/xyg/tests/fixtures/graphforge/results-0.6.0-rc.5");
    const manifest = JSON.parse(fs.readFileSync(path.join(fixture, "manifest.json"), "utf8"));
    const base = manifest.bases[manifest.fixtures.node_similarity.base];
    const read = (name: string) => fs.readFileSync(path.join(fixture, `${name}.arrow`));
    const c = xy.composeGraphForge({ base: { tables: [read(base.nodes), read(base.edges)], generation: base.generation },
      layers: [{ result: read("node_similarity"), resultId: "similarity", intent: "graph", generation: base.generation }] });
    const index = [...c.edges.derived].findIndex((derived: unknown) => derived === 1);
    const identity = c.identify("edge", index);
    assert.equal(identity.uuid, null);
    const row = resultRowsFromXygPick(identity, "similarity", 100)[0];
    assert.equal(typeof row, "number");
    const selected = resultEntitiesFromXygRow(c, "similarity", row);
    assert.ok(selected.nodeIds.includes(identity.source) && selected.nodeIds.includes(identity.target));
    assert.deepEqual(selected.edgeIds, []);
    assert.deepEqual(resultEntitiesFromXygRow(c, "another-result", row), { nodeIds: [], edgeIds: [] });
  });
  test("scalar cells fall back to canonical row identities while entity cells stay specific", () => {
    const row = {
      a: { node_uuid: "a" }, r: { edge_uuid: "r" }, b: { node_uuid: "b" },
      source: "ABC", dist: 12,
    };
    assert.deepEqual(resultEntitySelection(row, "dist"), { nodeIds: ["a", "b"], edgeIds: ["r"] });
    assert.deepEqual(resultEntitySelection(row, "source"), { nodeIds: ["a", "b"], edgeIds: ["r"] });
    assert.deepEqual(resultEntitySelection(row, "a"), { nodeIds: ["a"], edgeIds: [] });
    assert.deepEqual(resultEntitySelection({ dist: 12 }, "dist"), { nodeIds: [], edgeIds: [] });
    assert.deepEqual(resultEntitySelection({ node_uuid: "a", edge_uuid: "r" }, "node_uuid"), { nodeIds: ["a"], edgeIds: [] });
  });
  test("reuses only matching Arrow content and generation", () => {
    const result = { columns: [], rows: [], rowCount: 0, ipc: Uint8Array.of(1, 2), generationUuid: "g1" };
    assert.equal(sameArrowResult(result, { ...result, ipc: Uint8Array.of(1, 2) }), true);
    assert.equal(sameArrowResult(result, { ...result, generationUuid: "g2" }), false);
    assert.equal(sameArrowResult(result, { ...result, ipc: Uint8Array.of(1, 3) }), false);
    assert.equal(sameArrowResult({ ...result, ipc: undefined }, { ...result, ipc: undefined }), false);
    assert.equal(sameArrowResult(result, undefined), false);
    assert.equal(sameArrowResult(), true);
  });
  test("preserves Core Arrow metadata and bytes for XYG", () => {
    const table = tableFromArrays({ value: Float64Array.of(1, 2) });
    table.schema.metadata.set("graphforge.algorithm", "pagerank");
    const ipc = Buffer.from(tableToIPC(table));
    const result = decodeTable(ipc);
    result.generationUuid = "0190a000-0000-7000-8000-000000000006";
    const spec = createResultGraphSpec({
      name: "Graph",
      result: "results/a.json",
    });
    assert.equal(graphInput(spec, result).base!.tables[0], ipc);
    assert.equal(graphInput(spec, result).base!.generation, result.generationUuid);
    assert.equal(result.algorithm, "pagerank");
    assert.deepEqual(result.rows, [{ value: 1 }, { value: 2 }]);
  });
  test("rejects missing Arrow and ambiguous graph filtering", () => {
    const result = { columns: ["x"], rows: [{ x: 1 }], rowCount: 1 };
    const spec = createResultGraphSpec({
      name: "Graph",
      result: "results/a.json",
    });
    assert.throws(() => graphInput(spec, result), /XYG_ARROW_REQUIRED/);
    assert.throws(
      () =>
        graphInput(
          {
            ...spec,
            filters: [{ column: "x", operator: "equals", value: "1" }],
          },
          { ...result, ipc: Uint8Array.of(1) },
        ),
      /XYG_GRAPH_FILTER_REQUIRED/,
    );
    assert.throws(
      () => numericColumn({ ...result, rows: [{ x: "1" }] }, "x"),
      /XYG_FIELD_TYPE/,
    );
    assert.deepEqual(
      [
        ...numericColumn(
          { ...result, rows: [{ x: "12" }], numericColumns: ["x"] },
          "x",
        ),
      ],
      [12],
    );
    assert.throws(
      () =>
        numericColumn(
          {
            ...result,
            rows: [{ x: "9007199254740992" }],
            numericColumns: ["x"],
          },
          "x",
        ),
      /XYG_FIELD_RANGE/,
    );
    assert.throws(
      () =>
        graphInput(
          { ...spec, intent: "graph" },
          { ...result, ipc: Uint8Array.of(1) },
          { ...result, ipc: Uint8Array.of(1) },
        ),
      /XYG_GENERATION_REQUIRED/,
    );
  });
  test("rejects obsolete, executable and invalid intent documents", () => {
    const spec = createResultGraphSpec({
      name: "Graph",
      result: "results/a.json",
    });
    assert.ok(isVisualizationSpec(spec));
    for (const invalid of [
      { ...spec, format: "graphforge.visualization/v2" },
      { ...spec, renderer: "other" },
      { ...spec, graph: { ...spec.graph, callback: () => 1 } },
      { ...spec, result: "https://example.com/a.json" },
      { ...spec, graph: { layout: "cose", iterations: Infinity } },
    ])
      assert.equal(isVisualizationSpec(invalid), false);
  });
  test("native XYG owns chart, temporal and geographic scene composition", async function () {
    this.timeout(30000);
    const xy = await loadXyg(root);
    const data = {
      columns: ["x", "y", "timestamp", "lon", "lat", "toLon", "toLat"],
      rows: [
        {
          x: 1,
          y: 10,
          timestamp: "2025-01-01T00:00:00Z",
          lon: -104,
          lat: 39,
          toLon: -100,
          toLat: 30,
        },
        {
          x: 2,
          y: 12,
          timestamp: "2025-02-01T00:00:00Z",
          lon: -100,
          lat: 30,
          toLon: -104,
          toLat: 39,
        },
      ],
      rowCount: 2,
    };
    const base = {
      format: "xyg.intent/v1" as const,
      name: "Test",
      result: "results/a.json",
      filters: [],
    };
    const chart: ProjectVisualizationSpec = {
      ...base,
      kind: "chart",
      chart: { mark: "scatter", x: "x", y: "y" },
    };
    assert.ok(
      composeChart(xy, chart, data, 900, 600, "light").buildPayload().buffers
        .byteLength > 0,
    );
    const time: ProjectVisualizationSpec = {
      ...base,
      kind: "temporal",
      temporal: {
        timestamp: "timestamp",
        value: "y",
        timezone: "UTC",
        mark: "line",
      },
    };
    const temporalPayload = composeChart(xy, time, data, 900, 600, "light").buildPayload();
    assert.ok(temporalPayload.buffers.byteLength > 0);
    assert.equal(temporalPayload.spec.axes.x.kind, "time");
    const hostile = '</script><script>globalThis.exportInjection=true</script>';
    const html = xy.toHtml({ ...temporalPayload, spec: { ...temporalPayload.spec, title: hostile } });
    assert.match(html, /connect-src 'none'/);
    assert.match(html, /xy\.renderStandalone/);
    assert.ok(html.includes(Buffer.from(temporalPayload.buffers).toString("base64")));
    assert.ok(!html.includes(hostile), "The owner escapes hostile text in both title and spec");
    assert.ok(html.includes("\\u003c/script\\u003e"));
    const map: ProjectVisualizationSpec = {
      ...base,
      kind: "geospatial",
      geospatial: {
        longitude: "lon",
        latitude: "lat",
        targetLongitude: "toLon",
        targetLatitude: "toLat",
        crs: 4326,
        projection: 3857,
        longitudeCenter: -98,
        latitudeCenter: 38,
        zoom: 3,
      },
    };
    for (const spec of [chart, time, map]) validateVisualization(xy, spec, data);
    for (const spec of [
      { ...chart, chart: { ...chart.chart!, x: "missing" } },
      { ...time, temporal: { ...time.temporal!, timestamp: "missing" } },
      { ...map, geospatial: { ...map.geospatial!, longitude: "missing" } },
    ]) assert.throws(() => validateVisualization(xy, spec, data), /XYG_FIELD_MISSING/);
    const compiled = composeMap(xy, map, data, 900, 600).compile();
    assert.ok(
      xy.sceneBrowserPainter(new Uint8Array(compiled.scene)).byteLength > 0,
    );
  });
  test("native force batching preserves settled positions and cancellation", async function () {
    this.timeout(30000);
    const xy = await loadXyg(root);
    const fixture = path.join(root, "vendor/xyg/tests/fixtures/graphforge/results");
    const manifest = JSON.parse(fs.readFileSync(path.join(fixture, "manifest.json"), "utf8"));
    const input = { base: { tables: [fs.readFileSync(path.join(fixture, "cypher-edges.arrow"))],
      generation: manifest.bases.cyclic.generation }, select: [] };
    for (const layout of ["cose", "force"]) for (const iterations of [250, 1000]) {
      const hashes: string[] = [];
      for (const chunkSteps of [10, 50]) {
        const owner = new xy.GraphForgeLayoutController();
        try {
          const payload = await owner.render(input, { layout, iterations, chunkSteps, width: 900, height: 600 });
          const hash = createHash("sha256").update(JSON.stringify(payload.positions.uuid));
          for (const values of [payload.positions.x, payload.positions.y])
            hash.update(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
          hashes.push(hash.digest("hex"));
        } finally { await owner.dispose(); }
      }
      assert.equal(hashes[0], hashes[1], `${layout}/${iterations} retains exact native positions`);
    }
    const owner = new xy.GraphForgeLayoutController();
    const abort = new AbortController();
    try {
      await assert.rejects(owner.render(input, { layout: "cose", iterations: 250, chunkSteps: 50,
        signal: abort.signal, onPayload: (payload: { phase: string }) => {
          if (payload.phase === "initial") abort.abort();
        } }), (error: unknown) => (error as { code?: string }).code === "GF_LAYOUT_ABORTED");
    } finally { await owner.dispose(); }
  });

  test("native XYG composes canonical Core entity Arrow without host graph reconstruction", async function () {
    this.timeout(30000);
    const xy = await loadXyg(root);
    const fixture = path.join(
      root,
      "vendor/xyg/tests/fixtures/graphforge/results",
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(fixture, "manifest.json"), "utf8"),
    );
    const source = manifest.bases.cyclic;
    const result = decodeTable(
      fs.readFileSync(path.join(fixture, "cypher-edges.arrow")),
    );
    result.generationUuid = source.generation;
    const input = graphInput(
      createResultGraphSpec({ name: "Graph", result: "results/a.json" }),
      result,
    );
    const composition = xy.composeGraphForge(input);
    assert.equal(composition.baseGeneration, source.generation);
    assert.equal(composition.nodes.count, 4);
    assert.equal(composition.edges.count, 5);
    const owner = new xy.GraphForgeLayoutController();
    try {
      const payload = await owner.render(
        input,
        { layout: "cose", iterations: 20, width: 900, height: 600 },
      );
      assert.deepEqual(payload.positions.uuid, composition.nodes.uuid);
      assert.ok(payload.buffer.byteLength > 0);
      assert.equal(payload.phase, "complete");
    } finally {
      await owner.dispose();
    }
  });
});
