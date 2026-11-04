import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  graphInput,
  numericColumn,
  loadXyg,
  composeChart,
  composeMap,
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
    assert.equal(graphInput(spec, result).base.tables[0], ipc);
    assert.equal(graphInput(spec, result).base.generation, result.generationUuid);
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
  test("native XYG owns chart, temporal and geographic scene composition", async () => {
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
    assert.ok(
      composeChart(xy, time, data, 900, 600, "light").buildPayload().buffers
        .byteLength > 0,
    );
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
    const compiled = composeMap(xy, map, data, 900, 600).compile();
    assert.ok(
      xy.sceneBrowserPainter(new Uint8Array(compiled.scene)).byteLength > 0,
    );
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
