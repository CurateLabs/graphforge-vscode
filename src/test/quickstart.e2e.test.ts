import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { serializeEntityMutation } from "../webview/entityMutation";
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
      const query = await vscode.commands.executeCommand<any>(
        "graphforge.runProjectQuery",
        { path: "queries/templates/routes-overview.cypher" },
      );
      assert.ok(!query?.error, JSON.stringify(query));
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
