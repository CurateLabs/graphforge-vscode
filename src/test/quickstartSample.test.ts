import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildQuickstartSeedCypher,
  isEmptyDir,
  isQuickstartSamplePath,
  loadQuickstartDataset,
  materializeQuickstartProjectFiles,
  QUICKSTART_DIR_NAME,
  QUICKSTART_MARKER_BYTES,
  QUICKSTART_NOTEBOOK_REL,
  repairQuickstartProjectFiles,
  resolveQuickstartPath,
  writeQuickstartMarker,
} from "../session/quickstartSample";
import {
  readProjectQuery,
  readProjectResult,
  readProjectVisualization,
  scanProjectArtifacts,
  VISUALIZATION_SPEC_FORMAT_V2,
} from "../session/projectArtifacts";

/** Repo root from dist/test/quickstartSample.test.js → ../.. */
const REPO_ROOT = path.resolve(__dirname, "..", "..");

suite("quickstartSample (#63)", () => {
  test("resolveQuickstartPath prefers explicit path", () => {
    const resolved = resolveQuickstartPath({
      path: "/tmp/custom-sample",
      workspaceFolder: "/ws",
      storageFolder: "/store",
    });
    assert.equal(resolved, path.resolve("/tmp/custom-sample"));
  });

  test("resolveQuickstartPath uses workspace then storage", () => {
    assert.equal(
      resolveQuickstartPath({ workspaceFolder: "/ws" }),
      path.join("/ws", QUICKSTART_DIR_NAME),
    );
    assert.equal(
      resolveQuickstartPath({ storageFolder: "/store" }),
      path.join("/store", QUICKSTART_DIR_NAME),
    );
  });

  test("marker round-trip", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gf-qs-marker-"));
    assert.equal(isQuickstartSamplePath(dir), false);
    writeQuickstartMarker(dir);
    assert.equal(fs.readFileSync(path.join(dir, "QUICKSTART"), "utf8"), QUICKSTART_MARKER_BYTES);
    assert.equal(isQuickstartSamplePath(dir), true);
  });

  test("isEmptyDir treats missing and empty as empty", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gf-qs-empty-"));
    assert.equal(isEmptyDir(dir), true);
    assert.equal(isEmptyDir(path.join(dir, "missing")), true);
    fs.writeFileSync(path.join(dir, "x"), "1");
    assert.equal(isEmptyDir(dir), false);
  });

  test("loads vendored Apache-2.0 US air-routes dataset", () => {
    const dataset = loadQuickstartDataset(REPO_ROOT);
    assert.ok(dataset.airports.length >= 500, `airports=${dataset.airports.length}`);
    assert.ok(dataset.routes.length >= 7000, `routes=${dataset.routes.length}`);
    assert.ok(fs.existsSync(path.join(dataset.datasetDir, "NOTICE")));
    assert.ok(fs.existsSync(path.join(dataset.datasetDir, "LICENSE")));
  });

  test("seed Cypher materializes Airport/ROUTE from the real CSV", () => {
    const dataset = loadQuickstartDataset(REPO_ROOT);
    const seed = buildQuickstartSeedCypher(dataset);
    assert.ok(seed.startsWith("CREATE "));
    assert.ok(seed.includes(":Airport"));
    assert.ok(seed.includes("[:ROUTE"));
    assert.ok(seed.includes("ATL") || seed.includes("code:"));
    assert.equal((seed.match(/:Airport \{/g) ?? []).length, dataset.airports.length);
  });

  test("materializes the explicit visualization matrix and supporting data", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gf-qs-files-"));
    const dataset = loadQuickstartDataset(REPO_ROOT);
    const { seedMutationPath } = materializeQuickstartProjectFiles(projectRoot, dataset);
    const artifacts = scanProjectArtifacts(projectRoot);

    assert.equal(artifacts.queries.length, 0);
    assert.equal(artifacts.queryTemplates.length, 1);
    assert.deepEqual(
      artifacts.notebooks.map((item) => item.path),
      [QUICKSTART_NOTEBOOK_REL.split(path.sep).join("/")],
    );
    assert.equal(artifacts.visualizations.length, 7);
    assert.ok(artifacts.mutations.some((item) => item.path === seedMutationPath));
    assert.ok(fs.existsSync(path.join(projectRoot, "data", "air-routes", "airports.csv")));
    const notebookPath = path.join(projectRoot, QUICKSTART_NOTEBOOK_REL);
    assert.ok(fs.existsSync(notebookPath));
    const notebook = JSON.parse(fs.readFileSync(notebookPath, "utf8")) as {
      nbformat?: number;
      cells?: Array<{ cell_type?: string; source?: string[]; outputs?: unknown[] }>;
      metadata?: { kernelspec?: { language?: string } };
    };
    assert.equal(notebook.nbformat, 4);
    assert.equal(notebook.metadata?.kernelspec?.language, "python");
    const cellIds = notebook.cells?.map((cell) => (cell as { id?: string }).id);
    assert.ok(cellIds?.every((id) => typeof id === "string" && id.length > 0));
    assert.equal(new Set(cellIds).size, cellIds?.length);
    assert.ok(notebook.cells?.some((cell) =>
      cell.cell_type === "code" && cell.source?.join("").includes("forge.rank(")
    ));
    assert.ok(notebook.cells?.some((cell) =>
      cell.cell_type === "code" &&
      cell.source?.join("").includes("results/python-airport-pagerank.json")
    ));
    assert.ok(notebook.cells?.every((cell) => (cell.outputs?.length ?? 0) === 0));
    assert.match(
      fs.readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8"),
      /graphforge\.agent\.getContext/,
    );

    const query = readProjectQuery(projectRoot, artifacts.queryTemplates[0].path);
    assert.ok(query.cypher.includes("AS source"));
    assert.ok(query.cypher.includes("AS dist"));
    assert.ok(query.cypher.includes("AS region"));
    assert.ok(query.cypher.includes("AS sourceLongitude"));
    assert.ok(query.cypher.includes("AS sourceLatitude"));
    assert.ok(query.cypher.includes("AS targetLongitude"));
    assert.ok(query.cypher.includes("AS targetLatitude"));

    const legacyFiles = ["route-distances.gfviz.json", "routes-network.gfviz.json"];
    for (const fileName of legacyFiles) {
      const templatePath = path.join(dataset.datasetDir, "project", "visualizations", fileName);
      const materializedPath = path.join(projectRoot, "visualizations", fileName);
      const templateText = fs.readFileSync(templatePath, "utf8");
      assert.equal(
        fs.readFileSync(materializedPath, "utf8"),
        templateText,
        `${fileName} must be copied byte-for-byte`,
      );
      const loaded = readProjectVisualization(
        projectRoot,
        path.posix.join("visualizations", fileName),
      );
      assert.deepEqual(loaded, JSON.parse(templateText));
      assert.equal(loaded.format, "graphforge.visualization/v1");
    }

    const specs = artifacts.visualizations.map((item) =>
      readProjectVisualization(projectRoot, item.path),
    );
    const v2 = specs.filter((spec) => spec.format === VISUALIZATION_SPEC_FORMAT_V2);
    assert.equal(v2.length, 5);
    assert.ok(v2.some((spec) => spec.kind === "result-graph" && spec.renderer.id === "cytoscape"));
    assert.ok(v2.some((spec) => spec.kind === "result-graph" && spec.renderer.id === "g6"));
    assert.ok(v2.some((spec) => spec.kind === "chart" && spec.renderer.id === "g2"));
    assert.ok(v2.some((spec) => spec.kind === "geospatial" && spec.renderer.id === "l7"));
    assert.ok(v2.some((spec) => spec.kind === "temporal" && spec.renderer.id === "g2"));
    const geospatial = v2.find((spec) => spec.kind === "geospatial");
    assert.ok(geospatial);
    assert.equal(geospatial.geospatial.source.type, "links");
    assert.deepEqual(geospatial.geospatial.layers.map((layer) => layer.type), ["arc", "point"]);

    const plotly = specs.find((spec) => spec.kind === "plotly");
    assert.ok(plotly);
    assert.equal(plotly.result, "results/query-result.json");

    const activity = readProjectResult(projectRoot, "results/route-activity.json");
    assert.deepEqual(activity.columns, ["timestamp", "routes", "region"]);
    assert.equal(activity.rowCount, 12);
    assert.ok(activity.rows.every((row) => !Number.isNaN(Date.parse(String(row.timestamp)))));

    const temporal = v2.find((spec) => spec.kind === "temporal");
    assert.ok(temporal);
    assert.equal(temporal.result, "results/route-activity.json");
    assert.equal(temporal.temporal.timestampField, "timestamp");
    assert.equal(temporal.temporal.timezone, "UTC");
  });

  test("repairs newly shipped sample artifacts without overwriting analyst files", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gf-qs-repair-"));
    const dataset = loadQuickstartDataset(REPO_ROOT);
    fs.mkdirSync(path.join(projectRoot, "visualizations"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, "visualizations", "routes-network.gfviz.json"),
      "analyst-owned\n",
    );

    const repaired = repairQuickstartProjectFiles(projectRoot, dataset);

    assert.ok(repaired.includes(QUICKSTART_NOTEBOOK_REL.split(path.sep).join("/")));
    assert.ok(repaired.includes("visualizations/airports-map.gfviz.json"));
    assert.ok(repaired.includes("visualizations/routes-network-default.gfviz.json"));
    assert.equal(
      fs.readFileSync(
        path.join(projectRoot, "visualizations", "routes-network.gfviz.json"),
        "utf8",
      ),
      "analyst-owned\n",
    );
    assert.deepEqual(repairQuickstartProjectFiles(projectRoot, dataset), []);
  });
});
