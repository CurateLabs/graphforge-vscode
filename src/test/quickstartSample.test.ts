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
  resolveQuickstartPath,
  writeQuickstartMarker,
} from "../session/quickstartSample";
import {
  readProjectQuery,
  readProjectVisualization,
  scanProjectArtifacts,
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

  test("materializes project-backed query, visualizations, data, and mutation", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gf-qs-files-"));
    const dataset = loadQuickstartDataset(REPO_ROOT);
    const { seedMutationPath } = materializeQuickstartProjectFiles(projectRoot, dataset);
    const artifacts = scanProjectArtifacts(projectRoot);

    assert.equal(artifacts.queries.length, 0);
    assert.equal(artifacts.queryTemplates.length, 1);
    assert.equal(artifacts.visualizations.length, 2);
    assert.ok(artifacts.mutations.some((item) => item.path === seedMutationPath));
    assert.ok(fs.existsSync(path.join(projectRoot, "data", "air-routes", "airports.csv")));
    assert.match(
      fs.readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8"),
      /graphforge\.agent\.getContext/,
    );

    const query = readProjectQuery(projectRoot, artifacts.queryTemplates[0].path);
    assert.ok(query.cypher.includes("AS source"));
    assert.ok(query.cypher.includes("AS dist"));
    assert.ok(query.cypher.includes("AS region"));

    const plotly = artifacts.visualizations.find((item) => item.kind === "plotly");
    assert.ok(plotly);
    const spec = readProjectVisualization(projectRoot, plotly.path);
    assert.equal(spec.result, "results/query-result.json");
    assert.equal(spec.kind, "plotly");
  });
});
