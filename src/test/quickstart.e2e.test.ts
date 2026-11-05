import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { serializeEntityMutation } from "../webview/entityMutation";
import { buildGetStartedState } from "../views/getStartedView";
import type { GraphForgeSession } from "../session/graphForgeSession";
import {
  scanProjectArtifacts,
  writeProjectMutation,
} from "../session/projectArtifacts";

suite("XYG air-routes integration", () => {
  test("Core query → persisted Arrow → independent XYG graph/chart/map/timeline", async function () {
    this.timeout(180000);
    const extension = vscode.extensions.getExtension(
      "CurateLabsAI.graphforge",
    )!;
    await extension.activate();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gf-xyg-e2e-"));
    try {
      const opened = await vscode.commands.executeCommand<any>(
        "graphforge.openSampleProject",
        { path: root },
      );
      if (opened?.code === "RUNTIME_UNAVAILABLE") {
        if (process.env.GRAPHFORGE_REQUIRE_NATIVE)
          assert.fail("Native Core is required for XYG qualification.");
        this.skip();
      }
      assert.ok(opened?.seeded, JSON.stringify(opened));
      // An existing sample can still contain the pre-XYG scalar-only query.
      const queryPath = path.join(root, "queries/templates/routes-overview.cypher");
      const legacyQuery = fs.readFileSync(path.join(__dirname, "fixtures/legacy-routes-overview.cypher"));
      fs.writeFileSync(queryPath, legacyQuery);
      await vscode.commands.executeCommand("graphforge.closeProject");
      const repaired = await vscode.commands.executeCommand<any>(
        "graphforge.openSampleProject", { path: root },
      );
      assert.equal(repaired.seeded, false, JSON.stringify(repaired));
      assert.ok(repaired.repaired?.includes("queries/templates/routes-overview.cypher"));
      assert.deepEqual(fs.readFileSync(`${queryPath}.pre-xyg`), legacyQuery);
      fs.writeFileSync(path.join(root, "queries/templates/aaa-analysis.cypher"), "RETURN 1 AS value");
      const onboarding = await buildGetStartedState({
        project: { rootPath: root, name: "Sample" }, hasLastResult: false,
        hasUsableRuntime: async () => true,
        environmentSnapshot: async () => ({ node: { available: true }, python: { available: false }, projectKind: "node" }),
      } as unknown as GraphForgeSession);
      assert.deepEqual(onboarding.steps.find(step => step.id === "query")?.primaryAction?.args,
        [{ path: "queries/templates/routes-overview.cypher" }]);
      const query = await vscode.commands.executeCommand<any>(
        "graphforge.runProjectQuery",
        { path: "queries/templates/routes-overview.cypher" },
      );
      assert.ok(!query?.error, JSON.stringify(query));
      assert.equal(query.sourceQuery, "queries/templates/routes-overview.cypher");
      const invalidFilter = await vscode.commands.executeCommand<any>("graphforge.createProjectVisualization", {
        name: "rejected-filter", kind: "result-graph", result: "results/query-result.json",
        filter: { column: "region", operator: "equals", value: "US-TX" },
      });
      assert.match(invalidFilter.error, /XYG_GRAPH_FILTER_REQUIRED/);
      assert.equal(fs.existsSync(path.join(root, "visualizations/rejected-filter.gfviz.json")), false);
      for (const bindings of [
        { kind: "chart", mark: "scatter", x: "missing", y: "dist" },
        { kind: "geospatial", longitude: "missing", latitude: "lat" },
        { kind: "temporal", timestamp: "missing", y: "dist" },
        { kind: "chart", mark: "scatter", x: "dist", y: "dist", filter: { column: "missing", operator: "equals", value: "x" } },
      ]) {
        const rejected = await vscode.commands.executeCommand<any>("graphforge.createProjectVisualization", {
          name: "rejected-binding", result: "results/query-result.json", open: false, ...bindings,
        });
        assert.match(rejected.error, /XYG_FIELD_MISSING/);
        assert.equal(fs.existsSync(path.join(root, "visualizations/rejected-binding.gfviz.json")), false);
      }
      const chartPath = path.join(root, "visualizations/route-distances.gfviz.json");
      const savedChart = fs.readFileSync(chartPath, "utf8");
      const invalidChart = JSON.parse(savedChart);
      invalidChart.chart.x = "missing";
      const rejectedReplacement = await vscode.commands.executeCommand<any>("graphforge.saveProjectVisualization", {
        name: "route-distances", spec: invalidChart, open: false,
      });
      assert.match(rejectedReplacement.error, /XYG_FIELD_MISSING/);
      assert.equal(fs.readFileSync(chartPath, "utf8"), savedChart);
      const immediateGraph = await vscode.commands.executeCommand<any>(
        "graphforge.showResultGraph", { waitForReady: true },
      );
      assert.equal(immediateGraph.lifecycle?.type, "graphforge/renderReady", JSON.stringify(immediateGraph));
      assert.equal(immediateGraph.lifecycle.nodeCount, 579);
      assert.ok(immediateGraph.lifecycle.width > 0 && immediateGraph.lifecycle.width <= 4096);
      assert.ok(immediateGraph.lifecycle.height > 0 && immediateGraph.lifecycle.height <= 4096);
      if (process.env.GRAPHFORGE_REDUCED_MOTION_REQUIRED) assert.equal(immediateGraph.lifecycle.reducedMotion, true);
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      const entity = query.rows[0].a;
      const { node_uuid, labels, ...properties } = entity;
      assert.equal(typeof node_uuid, "string");
      const edit = serializeEntityMutation(
        { kind: "node", item: { id: node_uuid, labels, properties } },
        { ...properties, xygVerification: true },
      );
      const mutationPath = writeProjectMutation(
        root,
        "verify-canonical-edit",
        edit.cypher,
        edit.params,
      );
      const applied = await vscode.commands.executeCommand<any>(
        "graphforge.applyProjectMutation",
        { path: mutationPath, confirm: true },
      );
      assert.ok(!applied?.error, JSON.stringify(applied));
      const verified = await vscode.commands.executeCommand<any>(
        "graphforge.runQuery",
        {
          cypher:
            "MATCH (n) WHERE n.node_uuid = $id RETURN n.xygVerification AS verified",
          params: { id: { $uuid: node_uuid } },
        },
      );
      assert.equal(
        verified.rows?.[0]?.verified,
        true,
        JSON.stringify(verified),
      );
      await vscode.commands.executeCommand("graphforge.runProjectQuery", {
        path: "queries/templates/routes-overview.cypher",
      });
      assert.ok(
        fs.statSync(path.join(root, "results/query-result.arrow")).size >
          100000,
      );
      const specs = scanProjectArtifacts(root).visualizations;
      assert.equal(specs.length, 4);
      const instances = new Set<string>();
      for (const spec of specs) {
        const result = await vscode.commands.executeCommand<any>(
          "graphforge.openProjectVisualization",
          { path: spec.path, waitForReady: true, timeoutMs: 60000 },
        );
        assert.equal(
          result.lifecycle?.type,
          "graphforge/renderReady",
          JSON.stringify(result),
        );
        assert.equal(result.lifecycle.renderer, "xyg");
        instances.add(result.instanceId);
        const exported = await vscode.commands.executeCommand<any>(
          "graphforge.exportVisualization",
        );
        if (spec.kind === "temporal") {
          assert.match(
            exported?.error ?? "",
            /XYG_SCENE_UNSUPPORTED_PUBLIC_AXIS/,
          );
        } else {
          assert.ok(exported?.pngPath, JSON.stringify(exported));
          assert.equal(
            fs.readFileSync(exported.pngPath).subarray(0, 8).toString("hex"),
            "89504e470d0a1a0a",
          );
          assert.match(fs.readFileSync(exported.svgPath, "utf8"), /<svg/);
        }
        if (spec.kind === "result-graph")
          assert.equal(result.lifecycle.nodeCount, 579);
      }
      const reopened = await vscode.commands.executeCommand<any>(
        "graphforge.openProjectVisualization",
        { path: specs[0].path, waitForReady: true },
      );
      assert.equal(reopened.panel, "updated");
      assert.equal(
        reopened.lifecycle?.type,
        "graphforge/renderReady",
        JSON.stringify(reopened),
      );
      assert.equal(
        instances.size,
        4,
        "distinct artifacts retain independent instances",
      );
      // The isolated test profile owns these settings; leave the user's profile untouched.
      const graphSpec = specs.find(spec => spec.kind === "result-graph")!;
      for (const [theme, kind] of [
        ["Default High Contrast Light", vscode.ColorThemeKind.HighContrastLight],
        ["Default High Contrast", vscode.ColorThemeKind.HighContrast],
        ["Light+", vscode.ColorThemeKind.Light],
        ["Dark+", vscode.ColorThemeKind.Dark],
      ] as const) {
        const changed = new Promise<void>(resolve => {
          if (vscode.window.activeColorTheme.kind === kind) return resolve();
          const listener = vscode.window.onDidChangeActiveColorTheme(() => {
            if (vscode.window.activeColorTheme.kind === kind) { listener.dispose(); resolve(); }
          });
        });
        await vscode.workspace.getConfiguration("workbench").update("colorTheme", theme, vscode.ConfigurationTarget.Global);
        await changed;
        const themed = await vscode.commands.executeCommand<any>("graphforge.openProjectVisualization", { path: graphSpec.path, waitForReady: true });
        assert.equal(themed.lifecycle?.type, "graphforge/renderReady", JSON.stringify(themed));
        assert.equal(themed.lifecycle.nodeCount, 579);
      }
      const direct = await vscode.commands.executeCommand<any>(
        "graphforge.showResultGraph",
        { waitForReady: true },
      );
      assert.equal(
        direct.lifecycle?.type,
        "graphforge/renderReady",
        JSON.stringify(direct),
      );
      const empty = await vscode.commands.executeCommand<any>(
        "graphforge.runQuery",
        { cypher: "MATCH (a:Airport) WHERE a.code = 'ABSENT' RETURN a" },
      );
      assert.equal(empty.rowCount, 0, JSON.stringify(empty));
      const emptyGraph = await vscode.commands.executeCommand<any>(
        "graphforge.showResultGraph",
        { waitForReady: true },
      );
      assert.equal(
        emptyGraph.lifecycle?.type,
        "graphforge/renderReady",
        JSON.stringify(emptyGraph),
      );
      assert.equal(emptyGraph.lifecycle.nodeCount, 0);
      const tabs = vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .filter(
          (t) =>
            t.input instanceof vscode.TabInputWebview &&
            (t.input as vscode.TabInputWebview).viewType.endsWith(
              "graphforge.xyg",
            ),
        );
      assert.equal(tabs.length, 6);
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await vscode.commands.executeCommand("graphforge.closeProject");
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
