import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { decodeTable } from "../session/arrowCodec";
import type { QueryResult } from "../session/types";
import type { XygHost, XygIntent } from "../session/xygAdapter";
import {
  XygVisualizationPanel,
  type XygRowSelectionEvent,
} from "../webview/xygVisualizationPanel";

/**
 * Extension Development Host: a real webview, the real XYG native core, and
 * real GraphForge fixtures (#80).
 */
const FIXTURES = path.resolve(__dirname, "fixtures", "graphforge-results");
const GENERATION = "01890000-0000-7000-8000-000000000001";

function bytes(name: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(FIXTURES, `${name}.arrow`)));
}

function result(name: string, resultId: string, generationUuid = GENERATION): QueryResult {
  return { ...decodeTable(Buffer.from(bytes(name))), provenance: { resultId, generationUuid } };
}

function extensionUri(): vscode.Uri {
  const extension = vscode.extensions.getExtension("CurateLabsAI.graphforge");
  assert.ok(extension, "GraphForge extension");
  return extension.extensionUri;
}

function request(
  name: string,
  resultId: string,
  intent: XygIntent,
  generationUuid = GENERATION,
  host: XygHost = "native",
) {
  return {
    title: name,
    result: result(name, resultId, generationUuid),
    ipc: bytes(name),
    intent,
    host,
    readBase: async () => ({
      tables: [bytes("base-cyclic-nodes"), bytes("base-cyclic-edges")],
      generation: GENERATION,
    }),
  };
}

suite("XYG visualization panel (#80)", () => {
  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("composes a GraphForge result over its base graph and paints it in the webview", async () => {
    const resultId = "01890000-0000-7000-8000-0000000000a1";
    const shown = XygVisualizationPanel.show(extensionUri(), request("pagerank", resultId, "graph"));
    const { panel, status, outcome } = await shown;
    const painted = panel.whenPainted();
    assert.equal(status, "opened");
    assert.equal(outcome.error, undefined);
    assert.equal(outcome.diagnostics?.kind, "graph");
    assert.equal(outcome.diagnostics?.layers[0].schema, "node-score");
    assert.equal(outcome.diagnostics?.nodes, 4);
    const settled = await panel.settled();
    assert.equal(settled?.error, undefined, settled?.error?.code ?? "");
    // The real webview painted XYG's payload under the strict nonce CSP.
    assert.deepEqual((await painted).painted, true, JSON.stringify(await painted));
    assert.equal(XygVisualizationPanel.forResult(resultId), panel);
  });

  test("Results rows select by UUID in the view; views of other results never match", async () => {
    const resultId = "01890000-0000-7000-8000-0000000000a2";
    const { panel } = await XygVisualizationPanel.show(extensionUri(), request("louvain", resultId, "graph"));
    assert.equal(await panel.selectRows([0]), 1);
    assert.equal(await panel.selectRows([99]), 0);
    assert.equal(XygVisualizationPanel.forResult("01890000-0000-7000-8000-0000000000ff"), undefined);
    const rows: XygRowSelectionEvent[] = [];
    const subscription = XygVisualizationPanel.onDidSelectRows((event) => rows.push(event));
    subscription.dispose();
    assert.deepEqual(rows, []);
  });

  test("table intents render XYG's escaped table; a stale generation fails with a stable code", async () => {
    const table = await XygVisualizationPanel.show(
      extensionUri(),
      request("triad_census", "01890000-0000-7000-8000-0000000000a3", "table"),
    );
    assert.equal(table.outcome.diagnostics?.kind, "table");

    const stale = await XygVisualizationPanel.show(
      extensionUri(),
      request("pagerank", "01890000-0000-7000-8000-0000000000a4", "graph", "01890000-0000-7000-8000-000000000002"),
    );
    assert.equal(stale.outcome.error?.code, "GF_COMPOSE_GENERATION_STALE");
    assert.match(stale.outcome.error?.nextAction ?? "", /Re-run/);
  });

  test("the direct-browser WASM host composes and paints the same request inside the webview", async () => {
    const resultId = "01890000-0000-7000-8000-0000000000a5";
    const shown = await XygVisualizationPanel.show(
      extensionUri(),
      request("node_similarity", resultId, "graph", GENERATION, "wasm"),
    );
    const painted = await shown.panel.whenPainted();
    assert.equal(painted.painted, true, JSON.stringify(painted));
    // Rows map to UUIDs inside the webview (it owns the WASM composition).
    const reselected = shown.panel.whenPainted();
    assert.equal(await shown.panel.selectRows([0]), 1);
    assert.equal((await reselected).painted, true);

    const table = await XygVisualizationPanel.show(
      extensionUri(),
      request("is_dag", "01890000-0000-7000-8000-0000000000a6", "table", GENERATION, "wasm"),
    );
    const tablePainted = await table.panel.whenPainted();
    assert.equal(tablePainted.painted, true, JSON.stringify(tablePainted));
  });

  test("Visualize Result refuses Cypher results instead of falling back", async () => {
    const outcome = await vscode.commands.executeCommand<Record<string, unknown>>("graphforge.visualizeResult", {
      intent: "graph",
    });
    assert.ok(outcome && typeof outcome.code === "string", JSON.stringify(outcome));
    assert.match(String(outcome.code), /^GF_RESULT_(MISSING|NOT_ALGORITHM)$/);
  });
});
