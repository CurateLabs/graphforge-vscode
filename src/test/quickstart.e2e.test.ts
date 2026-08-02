import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { loadQuickstartDataset } from "../session/quickstartSample";
import {
  readProjectVisualization,
  scanProjectArtifacts,
} from "../session/projectArtifacts";

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
      const graphSpec = artifacts.visualizations.find((item) => {
        if (item.kind !== "result-graph") return false;
        return readProjectVisualization(opened.path!, item.path).format === "graphforge.visualization/v2";
      });
      const figureSpec = artifacts.visualizations.find((item) => item.kind === "plotly");
      const v2CompanionSpecs = artifacts.visualizations.filter((item) =>
        item.kind === "chart" || item.kind === "geospatial" || item.kind === "temporal",
      );
      assert.ok(query, "sample query must be a project file");
      assert.ok(graphSpec, "sample graph visualization must be a project file");
      assert.ok(figureSpec, "sample Plotly visualization must be a project file");
      assert.deepEqual(
        v2CompanionSpecs.map((item) => item.kind).sort(),
        ["chart", "geospatial", "temporal"],
      );
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
      assert.ok(queryResult.columns?.includes("longitude"));
      assert.ok(queryResult.columns?.includes("latitude"));
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

      const visualizationCountBeforeRejectedCreates =
        scanProjectArtifacts(opened.path!).visualizations.length;
      const rejectedCreates = await Promise.all([
        vscode.commands.executeCommand<{ error?: string }>(
          "graphforge.createProjectVisualization",
          {
            result: "results/query-result.json",
            kind: "result-graph",
            renderer: "plotly",
            open: false,
          },
        ),
        vscode.commands.executeCommand<{ error?: string }>(
          "graphforge.createProjectVisualization",
          {
            result: "results/query-result.json",
            kind: "result-graph",
            filter: { column: "region", operator: "equals" },
            open: false,
          },
        ),
        vscode.commands.executeCommand<{ error?: string }>(
          "graphforge.createProjectVisualization",
          {
            result: "results/query-result.json",
            kind: "chart",
            mark: "bar",
            x: "missing-field",
            y: "dist",
            open: false,
          },
        ),
        vscode.commands.executeCommand<{ error?: string }>(
          "graphforge.createProjectVisualization",
          {
            result: "results/query-result.json",
            kind: "temporal",
            mark: "scatter",
            timestamp: "observed_at",
            y: "route_count",
            open: false,
          },
        ),
      ]);
      for (const rejected of rejectedCreates) {
        assert.ok(rejected?.error, "invalid creation input must fail closed");
      }
      assert.equal(
        scanProjectArtifacts(opened.path!).visualizations.length,
        visualizationCountBeforeRejectedCreates,
        "invalid creation input must not persist an artifact",
      );

      const graph = await vscode.commands.executeCommand<{
        panel?: string;
        nodes?: number;
        edges?: number;
        styleMode?: string;
        lifecycle?: {
          type: string;
          renderer: string;
          backend?: string;
          nodeCount?: number;
          edgeCount?: number;
          code?: string;
          message?: string;
        };
      }>("graphforge.openProjectVisualization", {
        path: graphSpec.path,
        waitForReady: true,
        timeoutMs: 30_000,
      });

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
      const rendered = graph?.lifecycle;
      assert.ok(rendered, "G6 terminal lifecycle was not returned.");
      assert.notEqual(rendered.type, "graphforge/renderFailed", `${rendered.code}: ${rendered.message}`);
      assert.equal(rendered.type, "graphforge/renderReady");
      assert.equal(rendered.renderer, "g6");
      assert.equal(rendered.backend, "canvas");
      assert.ok((rendered.nodeCount ?? 0) >= minGraphNodes);
      assert.ok((rendered.edgeCount ?? 0) >= minRoutes);

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

      for (const artifact of v2CompanionSpecs) {
        const openedVisualization = await vscode.commands.executeCommand<{
          path?: string;
          kind?: string;
          panel?: string;
          error?: string;
        }>("graphforge.openProjectVisualization", { path: artifact.path });
        assert.equal(openedVisualization?.error, undefined, JSON.stringify(openedVisualization));
        assert.equal(openedVisualization?.path, artifact.path);
        assert.equal(openedVisualization?.kind, artifact.kind);
        assert.ok(
          openedVisualization?.panel === "opened" || openedVisualization?.panel === "updated",
        );
        // Let the retained webview finish each adapter before replacing it with
        // the next artifact; render failures are surfaced in the host log.
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    } finally {
      // Always detach so later “no project” suites in this host stay fail-closed.
      await vscode.commands.executeCommand("graphforge.closeProject");
    }
  });
});
