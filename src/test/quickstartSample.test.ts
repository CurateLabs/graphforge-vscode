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
} from "../session/projectArtifacts";

/** Repo root from dist/test/quickstartSample.test.js → ../.. */
const REPO_ROOT = path.resolve(__dirname, "..", "..");

suite("quickstartSample (#63)", () => {
  test("resolveQuickstartPath prefers explicit path", () => {
    const resolved = resolveQuickstartPath({ path: "/tmp/custom-sample" });
    assert.equal(resolved, path.resolve("/tmp/custom-sample"));
  });

  test("resolveQuickstartPath defaults to a visible Downloads project", () => {
    assert.equal(
      resolveQuickstartPath(),
      path.join(os.homedir(), "Downloads", QUICKSTART_DIR_NAME),
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
    assert.deepEqual(artifacts.apps.map((item) => item.path), ["apps/air_routes_dashboard.py"]);
    assert.equal(artifacts.visualizations.length, 4);
    assert.ok(artifacts.mutations.some((item) => item.path === seedMutationPath));
    assert.ok(fs.existsSync(path.join(projectRoot, "data", "air-routes", "airports.csv")));
    const notebookPath = path.join(projectRoot, QUICKSTART_NOTEBOOK_REL);
    assert.ok(fs.existsSync(notebookPath));
    const streamlitPath = path.join(projectRoot, "apps", "air_routes_dashboard.py");
    assert.ok(fs.existsSync(streamlitPath));
    assert.match(fs.readFileSync(streamlitPath, "utf8"), /components\.html/);
    assert.match(fs.readFileSync(streamlitPath, "utf8"), /streamlit run apps\/air_routes_dashboard\.py/);
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
      cell.source?.join("").includes("notebooks' / 'outputs'")
    ));
    assert.ok(notebook.cells?.some((cell) =>
      cell.cell_type === "code" &&
      cell.source?.join("").includes("air-routes-pagerank.html")
    ));
    assert.equal(notebook.cells?.some((cell) =>
      cell.source?.join("").includes("graphforge.visualization/v2")
    ), false);
    assert.equal(notebook.cells?.some((cell) =>
      cell.source?.join("").includes("python-airport-pagerank.gfviz.json")
    ), false);
    assert.ok(notebook.cells?.some((cell) =>
      cell.source?.join("").includes("Portable HTML:")
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

    const specs=artifacts.visualizations.map(item=>readProjectVisualization(projectRoot,item.path));
    assert.deepEqual(specs.map(spec=>spec.kind).sort(),['chart','geospatial','result-graph','temporal']);
    assert.ok(specs.every(spec=>spec.format==='xyg.intent/v1'));
    const graph=specs.find(spec=>spec.kind==='result-graph')!;
    assert.equal(graph.graph!.layout,'cose');
    const geo=specs.find(spec=>spec.kind==='geospatial')!;
    assert.equal(geo.geospatial!.targetLongitude,'targetLongitude');
    const activity=readProjectResult(projectRoot,'results/route-activity.json');
    assert.equal(activity.rowCount,12);
    assert.equal(specs.find(spec=>spec.kind==='temporal')!.temporal!.timezone,'UTC');

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
    assert.ok(repaired.includes("visualizations/airports-map.gfviz.json"));
    assert.equal(
      fs.readFileSync(
        path.join(projectRoot, "visualizations", "routes-network.gfviz.json"),
        "utf8",
      ),
      "analyst-owned\n",
    );
    assert.deepEqual(repairQuickstartProjectFiles(projectRoot, dataset), []);
  });

  test("upgrades the unchanged legacy sample query with a preserved backup", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gf-qs-xyg-upgrade-"));
    const dataset = loadQuickstartDataset(REPO_ROOT);
    materializeQuickstartProjectFiles(projectRoot, dataset);
    const relative = "queries/templates/routes-overview.cypher";
    const file = path.join(projectRoot, relative);
    const legacy = fs.readFileSync(path.join(__dirname, "fixtures/legacy-routes-overview.cypher"));
    fs.writeFileSync(file, legacy);
    try {
      assert.deepEqual(repairQuickstartProjectFiles(projectRoot, dataset), [relative]);
      assert.match(fs.readFileSync(file, "utf8"), /RETURN a, r, b,/);
      assert.deepEqual(fs.readFileSync(`${file}.pre-xyg`), legacy);
      assert.equal(scanProjectArtifacts(projectRoot).queryTemplates.length, 1);
      assert.deepEqual(repairQuickstartProjectFiles(projectRoot, dataset), []);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("preserves a customized default sample query during repair", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gf-qs-custom-query-"));
    const dataset = loadQuickstartDataset(REPO_ROOT);
    materializeQuickstartProjectFiles(projectRoot, dataset);
    const file = path.join(projectRoot, "queries/templates/routes-overview.cypher");
    const custom = "MATCH (a:Airport) RETURN a LIMIT 10\n";
    fs.writeFileSync(file, custom);
    try {
      assert.deepEqual(repairQuickstartProjectFiles(projectRoot, dataset), []);
      assert.equal(fs.readFileSync(file, "utf8"), custom);
      assert.equal(fs.existsSync(`${file}.pre-xyg`), false);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("does not overwrite a conflicting sample query backup", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gf-qs-query-backup-"));
    const dataset = loadQuickstartDataset(REPO_ROOT);
    materializeQuickstartProjectFiles(projectRoot, dataset);
    const file = path.join(projectRoot, "queries/templates/routes-overview.cypher");
    const legacy = fs.readFileSync(path.join(__dirname, "fixtures/legacy-routes-overview.cypher"));
    fs.writeFileSync(file, legacy);
    fs.writeFileSync(`${file}.pre-xyg`, "existing backup");
    try {
      assert.throws(() => repairQuickstartProjectFiles(projectRoot, dataset), /backup already exists/);
      assert.deepEqual(fs.readFileSync(file), legacy);
      assert.equal(fs.readFileSync(`${file}.pre-xyg`, "utf8"), "existing backup");
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
