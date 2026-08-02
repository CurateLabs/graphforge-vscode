import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  artifactTimestamp,
  defaultArtifactName,
  filterQueryResult,
  readProjectQuery,
  readProjectVisualization,
  resolveProjectMutationPath,
  scanProjectArtifacts,
  VISUALIZATION_SPEC_FORMAT,
  VISUALIZATION_SPEC_FORMAT_V2,
  writeProjectMutation,
  writeProjectQuery,
  writeProjectQueryTemplate,
  writeProjectVisualization,
} from "../session/projectArtifacts";
import {
  createDefaultChartSpec,
  createDefaultResultGraphSpec,
} from "../session/visualizationRegistry";

suite("project artifacts", () => {
  test("writes, scans, and reloads query and visualization files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gf-artifacts-"));
    fs.mkdirSync(path.join(root, "results"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "results", "routes.json"),
      JSON.stringify({
        columns: ["source", "region"],
        rows: [{ source: "ATL", region: "US-GA" }],
        rowCount: 1,
      }),
    );

    const queryPath = writeProjectQuery(root, "regional routes", "MATCH (n) RETURN n");
    const visualizationPath = writeProjectVisualization(root, "regional graph", {
      format: VISUALIZATION_SPEC_FORMAT,
      name: "Regional graph",
      kind: "result-graph",
      result: "results/routes.json",
      filter: { column: "region", operator: "equals", value: "US-GA" },
      graph: { renderer: "sigma", layout: { gravity: 0.8, slowDown: 4 } },
    });

    const artifacts = scanProjectArtifacts(root);
    assert.equal(artifacts.queries[0]?.path, queryPath);
    assert.equal(artifacts.results[0]?.rowCount, 1);
    assert.equal(artifacts.visualizations[0]?.path, visualizationPath);
    assert.equal(readProjectQuery(root, queryPath).cypher, "MATCH (n) RETURN n\n");
    assert.equal(readProjectVisualization(root, visualizationPath).kind, "result-graph");
  });

  test("separates reusable templates and defaults optional artifact names", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gf-artifact-defaults-"));
    fs.mkdirSync(path.join(root, "results"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "results", "routes.json"),
      JSON.stringify({ columns: ["code"], rows: [{ code: "ATL" }], rowCount: 1 }),
    );

    const templatePath = writeProjectQueryTemplate(
      root,
      undefined,
      "MATCH (n) RETURN n",
    );
    const visualizationPath = writeProjectVisualization(root, undefined, {
      format: VISUALIZATION_SPEC_FORMAT,
      name: "",
      kind: "result-graph",
      result: "results/routes.json",
      graph: { renderer: "cytoscape" },
    });
    const artifacts = scanProjectArtifacts(root);

    assert.equal(artifacts.queries.length, 0);
    assert.equal(artifacts.queryTemplates[0]?.path, templatePath);
    assert.match(templatePath, /^queries\/templates\/query-\d{8}-\d{6}-\d{3}\.cypher$/);
    assert.match(
      visualizationPath,
      /^visualizations\/vis-\d{8}-\d{6}-\d{3}\.gfviz\.json$/,
    );
    assert.match(
      readProjectVisualization(root, visualizationPath).name,
      /^vis-\d{8}-\d{6}-\d{3}$/,
    );
  });

  test("reads existing v1 visualization JSON exactly without migration", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gf-artifact-v1-"));
    fs.mkdirSync(path.join(root, "visualizations"), { recursive: true });
    const original = {
      format: VISUALIZATION_SPEC_FORMAT,
      name: "Legacy routes",
      kind: "result-graph",
      result: "results/routes.json",
      graph: { renderer: "cytoscape", layout: { gravity: 0.7 } },
    };
    const artifactPath = "visualizations/legacy.gfviz.json";
    fs.writeFileSync(path.join(root, artifactPath), `${JSON.stringify(original, null, 2)}\n`);

    const loaded = readProjectVisualization(root, artifactPath);

    assert.deepEqual(loaded, original);
    assert.equal(loaded.format, "graphforge.visualization/v1");
    assert.equal(fs.readFileSync(path.join(root, artifactPath), "utf8"), `${JSON.stringify(original, null, 2)}\n`);
  });

  test("writes, scans, and reloads strict v2 graph and chart artifacts", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gf-artifact-v2-"));
    fs.mkdirSync(path.join(root, "results"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "results", "routes.json"),
      JSON.stringify({ columns: ["origin", "distance"], rows: [], rowCount: 0 }),
    );
    const graph = createDefaultResultGraphSpec({
      name: "Routes",
      result: "results/routes.json",
    });
    const chart = createDefaultChartSpec({
      name: "Distances",
      result: "results/routes.json",
      mark: "bar",
      x: "origin",
      y: "distance",
    });

    const graphPath = writeProjectVisualization(root, graph.name, graph);
    const chartPath = writeProjectVisualization(root, chart.name, chart);

    assert.equal(readProjectVisualization(root, graphPath).format, VISUALIZATION_SPEC_FORMAT_V2);
    assert.equal(readProjectVisualization(root, chartPath).kind, "chart");
    assert.deepEqual(
      scanProjectArtifacts(root).visualizations.map((item) => item.kind).sort(),
      ["chart", "result-graph"],
    );
  });

  test("rejects invalid v2 renderer, remote result, and executable values", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gf-artifact-v2-invalid-"));
    fs.mkdirSync(path.join(root, "visualizations"), { recursive: true });
    const graph = createDefaultResultGraphSpec({
      name: "Routes",
      result: "results/routes.json",
    });
    const invalidPath = path.join(root, "visualizations", "invalid.gfviz.json");
    fs.writeFileSync(
      invalidPath,
      JSON.stringify({ ...graph, renderer: { id: "mystery", backend: "canvas" } }),
    );
    assert.throws(
      () => readProjectVisualization(root, "visualizations/invalid.gfviz.json"),
      /Invalid GraphForge visualization spec/,
    );
    assert.throws(
      () => writeProjectVisualization(root, "remote", { ...graph, result: "https://example.com/result.json" }),
      /Visualization settings are incomplete/,
    );
    assert.throws(
      () => writeProjectVisualization(root, "executable", {
        ...graph,
        graph: { ...graph.graph, callback: () => undefined },
      } as never),
      /Visualization settings are incomplete/,
    );
  });

  test("uses one UTC timestamp convention for unnamed artifacts", () => {
    const date = new Date("2026-08-02T05:29:07.123Z");
    assert.equal(artifactTimestamp(date), "20260802-052907-123");
    assert.equal(defaultArtifactName("results", date), "results-20260802-052907-123");
  });

  test("filters durable result rows without mutating the source", () => {
    const source = {
      columns: ["region"],
      rows: [{ region: "US-GA" }, { region: "US-TX" }],
      rowCount: 2,
    };
    const filtered = filterQueryResult(source, {
      column: "region",
      operator: "contains",
      value: "ga",
    });
    assert.equal(filtered.rowCount, 1);
    assert.equal(filtered.rows[0]?.region, "US-GA");
    assert.equal(source.rowCount, 2);
  });

  test("persists edit mutations without overwriting an existing record", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gf-mutations-"));
    const first = writeProjectMutation(
      root,
      "edit-node-atl",
      "MATCH (n) SET n.city = 'Atlanta'",
    );
    const second = writeProjectMutation(
      root,
      "edit-node-atl",
      "MATCH (n) SET n.city = 'Austin'",
    );

    assert.equal(first, "mutations/edit-node-atl.cypher");
    assert.equal(second, "mutations/edit-node-atl-2.cypher");
    assert.match(
      fs.readFileSync(path.join(root, second), "utf8"),
      /Austin/,
    );
    assert.equal(scanProjectArtifacts(root).mutations.length, 2);
  });

  test("rejects artifact traversal outside the project", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gf-artifacts-safe-"));
    assert.throws(
      () => readProjectQuery(root, "../outside.cypher"),
      /must stay inside the open project/,
    );
  });

  test("requires executable mutation paths to stay under mutations", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gf-mutation-path-"));
    fs.mkdirSync(path.join(root, "mutations"), { recursive: true });
    fs.mkdirSync(path.join(root, "queries"), { recursive: true });
    const mutation = path.join(root, "mutations", "apply.cypher");
    fs.writeFileSync(mutation, "CREATE (:Node)\n");
    fs.writeFileSync(path.join(root, "queries", "read.cypher"), "MATCH (n) RETURN n\n");

    assert.equal(resolveProjectMutationPath(root, mutation), mutation);
    assert.throws(
      () => resolveProjectMutationPath(root, "queries/read.cypher"),
      /must stay inside mutations\//,
    );
    assert.throws(
      () => resolveProjectMutationPath(root, "mutations/README.md"),
      /must be a \.cypher, \.cql, or \.json/,
    );
  });
});
