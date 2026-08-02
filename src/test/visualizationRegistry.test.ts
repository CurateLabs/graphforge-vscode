import * as assert from "node:assert/strict";
import {
  createDefaultChartSpec,
  createDefaultGeospatialSpec,
  createDefaultResultGraphSpec,
  createDefaultTemporalSpec,
  DEFAULT_VISUALIZATION_POLICY,
  isVisualizationSpecV2,
} from "../session/visualizationRegistry";

suite("visualization registry", () => {
  test("materializes the reversible AntV creation defaults", () => {
    assert.deepEqual(DEFAULT_VISUALIZATION_POLICY.resultGraph.renderer, {
      id: "g6",
      backend: "canvas",
    });
    assert.deepEqual(DEFAULT_VISUALIZATION_POLICY.resultGraph.layout, {
      type: "force-atlas2",
      execution: "worker",
      animation: false,
      maxIteration: 500,
      barnesHut: true,
      prune: true,
      preventOverlap: true,
      dissuadeHubs: false,
      nodeSize: 22,
      nodeSpacing: 4,
      kr: 5,
      kg: 1,
      ks: 0.1,
      ksmax: 10,
      tao: 0.1,
      mode: "normal",
    });
    assert.equal(DEFAULT_VISUALIZATION_POLICY.chart.renderer.id, "g2");
    assert.equal(DEFAULT_VISUALIZATION_POLICY.geospatial.renderer.id, "l7");
    assert.equal(DEFAULT_VISUALIZATION_POLICY.temporal.renderer.id, "g2");
  });

  test("creates complete strict specs for every v2 visualization kind", () => {
    const graph = createDefaultResultGraphSpec({
      name: "Routes",
      result: "results/routes.json",
    });
    const chart = createDefaultChartSpec({
      name: "Distances",
      result: "results/routes.json",
      mark: "scatter",
      x: "origin",
      y: "distance",
      color: "region",
    });
    const geospatial = createDefaultGeospatialSpec({
      name: "Airports",
      result: "results/airports.json",
      source: { type: "coordinates", longitudeField: "lon", latitudeField: "lat" },
      sourceCrs: "EPSG:4326",
      projection: "EPSG:3857",
      layers: [{
        id: "airports",
        type: "point",
        colorField: null,
        sizeField: null,
        shapeField: null,
        color: "#4c6ef5",
        opacity: 1,
        size: 5,
      }],
      viewport: { longitude: 0, latitude: 0, zoom: 1, bearing: 0, pitch: 0, bounds: null },
    });
    const temporal = createDefaultTemporalSpec({
      name: "Traffic",
      result: "results/traffic.json",
      mark: "line",
      timestampField: "observed_at",
      timezone: "UTC",
      granularity: "hour",
      valueField: "flights",
      seriesField: "airport",
    });

    for (const spec of [graph, chart, geospatial, temporal]) {
      assert.equal(isVisualizationSpecV2(spec), true, `${spec.kind} template must validate`);
      assert.deepEqual(spec.filters, []);
    }
    assert.deepEqual(graph.graph.timebar, { enabled: false });
    assert.deepEqual(graph.graph.style, {
      preset: "graphforge-epistemic/v1",
      nodeLabelFields: ["name", "label"],
      nodeLabelFallback: "label-or-id",
      edgeLabelField: "type",
      showEdgeLabels: false,
      nodeSize: 22,
      edgeWidth: 1.3,
      arrowheads: false,
    });
    assert.deepEqual(graph.graph.interactions, {
      pan: true,
      zoom: true,
      select: true,
      fit: true,
      relayout: true,
    });
    assert.equal(chart.chart.aggregation, "none");
    assert.deepEqual(geospatial.geospatial.basemap, { type: "blank" });
    assert.deepEqual(geospatial.geospatial.presentation, {
      title: "Airports",
      legend: false,
      theme: "editor",
    });
    assert.deepEqual(temporal.temporal.playback, {
      enabled: false,
      step: null,
      speedMs: null,
    });
  });

  test("rejects missing, unknown, executable, and remote renderer inputs", () => {
    const graph = createDefaultResultGraphSpec({
      name: "Routes",
      result: "results/routes.json",
    });
    const missingRenderer = { ...graph } as Record<string, unknown>;
    delete missingRenderer.renderer;
    assert.equal(isVisualizationSpecV2(missingRenderer), false);
    assert.equal(
      isVisualizationSpecV2({ ...graph, renderer: { id: "unknown", backend: "canvas" } }),
      false,
    );
    assert.equal(
      isVisualizationSpecV2({ ...graph, result: "https://example.com/routes.json" }),
      false,
    );
    assert.equal(
      isVisualizationSpecV2({ ...graph, graph: { ...graph.graph, callback: () => undefined } }),
      false,
    );
    assert.equal(
      isVisualizationSpecV2({ ...graph, name: "javascript:alert(1)" }),
      false,
    );
    assert.equal(
      isVisualizationSpecV2({ ...graph, name: "See https://example.com/routes" }),
      false,
    );
  });

  test("rejects undocumented configuration instead of silently accepting it", () => {
    const chart = createDefaultChartSpec({
      name: "Distances",
      result: "results/routes.json",
      mark: "bar",
      x: "origin",
      y: "distance",
    });
    assert.equal(
      isVisualizationSpecV2({
        ...chart,
        chart: { ...chart.chart, dataUrl: "https://example.com/data.json" },
      }),
      false,
    );
  });

  test("factories reject contradictory chart, geospatial, and temporal settings", () => {
    const histogram = createDefaultChartSpec({
      name: "Histogram",
      result: "results/routes.json",
      mark: "histogram",
      x: "distance",
      y: "ignored",
    });
    assert.equal(histogram.chart.bindings.y, null);
    assert.equal(isVisualizationSpecV2(histogram), true);
    assert.throws(
      () => createDefaultChartSpec({
        name: "Conflicting",
        result: "results/routes.json",
        mark: "bar",
        x: "origin",
        y: "distance",
        color: "region",
        series: "carrier",
      }),
      /either color or series/,
    );

    const layer = {
      id: "features",
      type: "point" as const,
      colorField: null,
      sizeField: null,
      shapeField: null,
      color: "#4c6ef5",
      opacity: 1,
      size: 5,
    };
    const geoBase = {
      name: "Map",
      result: "results/routes.json",
      source: { type: "coordinates" as const, longitudeField: "lon", latitudeField: "lat" },
      sourceCrs: "EPSG:4326" as const,
      projection: "EPSG:3857" as const,
      viewport: { longitude: 0, latitude: 0, zoom: 1, bearing: 0, pitch: 0, bounds: null },
    };
    assert.throws(() => createDefaultGeospatialSpec({ ...geoBase, layers: [] }), /at least one layer/);
    assert.throws(
      () => createDefaultGeospatialSpec({ ...geoBase, layers: [{ ...layer, type: "line" as const }] }),
      /point layers only/,
    );
    assert.throws(
      () => createDefaultTemporalSpec({
        name: "Timeline",
        result: "results/routes.json",
        mark: "line",
        timestampField: "observed_at",
        timezone: "Not/A-Timezone",
        granularity: "day",
        valueField: "count",
      }),
      /valid IANA timezone/,
    );
  });

  test("strict v2 filters and playback steps remain explicit", () => {
    const graph = createDefaultResultGraphSpec({
      name: "Routes",
      result: "results/routes.json",
      filters: [{ column: "region", operator: "equals", value: "   " }],
    });
    assert.equal(isVisualizationSpecV2(graph), false);

    const temporal = createDefaultTemporalSpec({
      name: "Traffic",
      result: "results/traffic.json",
      mark: "line",
      timestampField: "observed_at",
      timezone: "UTC",
      granularity: "hour",
      valueField: "flights",
    });
    assert.equal(isVisualizationSpecV2({
      ...temporal,
      temporal: { ...temporal.temporal, playback: { enabled: true, step: 1.5, speedMs: 100 } },
    }), false);
    assert.equal(isVisualizationSpecV2({
      ...temporal,
      temporal: { ...temporal.temporal, playback: { enabled: true, step: 2, speedMs: 100 } },
    }), true);
  });

  test("rejects coercible enum values but permits shared acyclic JSON values", () => {
    const sharedFilter = { column: "region", operator: "equals" as const, value: "US" };
    const graph = createDefaultResultGraphSpec({
      name: "Routes",
      result: "results/routes.json",
      filters: [sharedFilter, sharedFilter],
    });
    assert.equal(isVisualizationSpecV2(graph), true);

    const chart = createDefaultChartSpec({
      name: "Distances",
      result: "results/routes.json",
      mark: "bar",
      x: "origin",
      y: "distance",
    });
    assert.equal(
      isVisualizationSpecV2({
        ...chart,
        chart: { ...chart.chart, mark: ["bar"] },
      }),
      false,
    );
  });
});
