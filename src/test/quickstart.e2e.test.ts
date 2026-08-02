import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { loadQuickstartDataset } from "../session/quickstartSample";
import { scanProjectArtifacts } from "../session/projectArtifacts";

/**
 * Live engine path for #63 against the vendored US air-routes dataset
 * (Apache-2.0). Skips cleanly when the native binding cannot load.
 */
suite("Quickstart e2e (#63)", () => {
  test("openSample → query → Result Graph → Figure (US air-routes)", async function () {
    this.timeout(90_000);

    const ext = vscode.extensions.getExtension("CurateLabsAI.graphforge");
    assert.ok(ext);
    await ext.activate();

    const dataset = loadQuickstartDataset(ext.extensionPath);
    const minRoutes = dataset.routes.length;
    const touchedAirports = new Set<string>();
    for (const route of dataset.routes) {
      touchedAirports.add(route.from);
      touchedAirports.add(route.to);
    }
    const minGraphNodes = touchedAirports.size;
    assert.ok(dataset.airports.length >= 500);
    assert.ok(minRoutes >= 7000);
    assert.ok(minGraphNodes >= 500);

    const sampleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gf-quickstart-e2e-"));

    try {
      const opened = await vscode.commands.executeCommand<{
        path?: string;
        project?: { rootPath: string };
        seeded?: boolean;
        error?: string;
        code?: string;
        cancelled?: boolean;
        nextAction?: string;
      }>("graphforge.openSampleProject", { path: sampleRoot, force: true });

      if (opened && "code" in opened && opened.code === "RUNTIME_UNAVAILABLE") {
        console.warn(
          "[quickstart.e2e] Native @curatelabs/graphforge binding not loadable — skipping quickstart e2e",
        );
        this.skip();
      }

      assert.ok(opened && !("error" in opened && opened.error), `openSample failed: ${JSON.stringify(opened)}`);
      assert.ok(!opened.cancelled, "openSample cancelled unexpectedly");
      assert.equal(opened.seeded, true);
      assert.ok(opened.path);
      assert.ok(fs.existsSync(path.join(opened.path!, "FORMAT")));
      assert.ok(fs.existsSync(path.join(opened.path!, "QUICKSTART")));
      const artifacts = scanProjectArtifacts(opened.path!);
      const query = artifacts.queryTemplates.find(
        (item) => item.name === "routes-overview.cypher",
      );
      const graphSpec = artifacts.visualizations.find((item) => item.kind === "result-graph");
      const figureSpec = artifacts.visualizations.find((item) => item.kind === "plotly");
      assert.ok(query, "sample query must be a project file");
      assert.ok(graphSpec, "sample graph visualization must be a project file");
      assert.ok(figureSpec, "sample Plotly visualization must be a project file");
      assert.ok(
        artifacts.mutations.some((item) => item.name === "seed-air-routes.cypher"),
        "sample seed mutation must be a project file",
      );

      const queryResult = await vscode.commands.executeCommand<{
        rowCount?: number;
        columns?: string[];
        error?: string;
      }>("graphforge.runProjectQuery", { path: query.path });

      assert.ok(queryResult && !queryResult.error, `runQuery failed: ${JSON.stringify(queryResult)}`);
      assert.ok(
        (queryResult.rowCount ?? 0) >= minRoutes,
        `expected >= ${minRoutes} result rows, got ${queryResult.rowCount}`,
      );
      assert.ok(queryResult.columns?.includes("source"));
      assert.ok(queryResult.columns?.includes("dist"));
      assert.ok(queryResult.columns?.includes("region"));
      const persistedJson = path.join(opened.path!, "results", "query-result.json");
      const persistedMarkdown = path.join(opened.path!, "results", "query-result.md");
      assert.ok(fs.existsSync(persistedJson), "query JSON must persist inside the temp project");
      assert.ok(
        fs.existsSync(persistedMarkdown),
        "readable query result must persist inside the temp project",
      );
      const savedResult = JSON.parse(fs.readFileSync(persistedJson, "utf8")) as {
        rowCount?: number;
      };
      assert.equal(savedResult.rowCount, queryResult.rowCount);
      assert.ok(
        scanProjectArtifacts(opened.path!).results.some((item) =>
          /^results\/results-\d{8}-\d{6}-\d{3}\.json$/.test(item.path),
        ),
        "unnamed query result must use the timestamp naming convention",
      );

      const graph = await vscode.commands.executeCommand<{
        panel?: string;
        nodes?: number;
        edges?: number;
        styleMode?: string;
      }>("graphforge.openProjectVisualization", { path: graphSpec.path });

      assert.ok(graph?.panel === "opened" || graph?.panel === "updated");
      assert.ok(
        (graph?.nodes ?? 0) >= minGraphNodes,
        `Result Graph nodes: expected >= ${minGraphNodes}, got ${graph?.nodes}`,
      );
      assert.ok(
        (graph?.edges ?? 0) >= minRoutes,
        `Result Graph edges: expected >= ${minRoutes}, got ${graph?.edges}`,
      );
      assert.notEqual(graph?.styleMode, "demo");

      const figure = await vscode.commands.executeCommand<{
        figure?: { data?: unknown[] };
        panel?: string;
        error?: string;
        cancelled?: boolean;
      }>("graphforge.openProjectVisualization", { path: figureSpec.path });

      assert.ok(figure && !figure.error && !figure.cancelled, `figureFromResult failed: ${JSON.stringify(figure)}`);
      const figureOutcome = (figure as { outcome?: { figure?: { data?: unknown[] }; panel?: string } }).outcome;
      assert.ok(figureOutcome?.panel === "opened" || figureOutcome?.panel === "updated");
      assert.ok(
        Array.isArray(figureOutcome.figure?.data) && figureOutcome.figure!.data!.length > 0,
      );
    } finally {
      // Always detach so later “no project” suites in this host stay fail-closed.
      await vscode.commands.executeCommand("graphforge.closeProject");
    }
  });
});
