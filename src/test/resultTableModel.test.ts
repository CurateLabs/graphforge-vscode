import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import type { GraphPayload, QueryResult } from "../session/types";
import {
  jsonSafeQueryResult,
  resolveResultGraphHighlight,
  resolveResultEntitySelection,
  resultEntityLinks,
  resultRowsForGraphSelection,
} from "../webview/resultTableModel";

const result: QueryResult = {
  columns: ["source", "target", "dist", "airport"],
  rows: [
    {
      source: "ATL",
      target: "AUS",
      dist: 813,
      airport: { id: "airport-atl", code: "ATL" },
    },
  ],
  rowCount: 1,
};

const payload: GraphPayload = {
  nodes: [
    { id: "ATL", labels: ["Airport"], properties: { code: "ATL" } },
    { id: "AUS", labels: ["Airport"], properties: { code: "AUS" } },
  ],
  edges: [
    {
      id: "ATL->AUS",
      source: "ATL",
      target: "AUS",
      type: "ROUTE",
      properties: { edge_uuid: "route-1" },
    },
  ],
  legend: { statuses: [], types: ["Airport"] },
  styleMode: "class-only",
};

suite("result table ↔ graph linking", () => {
  test("contributes a WebviewView in a bottom Panel container", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"),
    ) as {
      contributes: {
        viewsContainers: { panel?: Array<{ id: string }> };
        views: Record<string, Array<{ id: string; type?: string }>>;
      };
    };
    assert.ok(
      manifest.contributes.viewsContainers.panel?.some(
        (container) => container.id === "graphforgeResults",
      ),
    );
    assert.ok(
      manifest.contributes.views.graphforgeResults?.some(
        (view) => view.id === "graphforge.results" && view.type === "webview",
      ),
    );
  });

  test("links an identity cell directly to one node", () => {
    assert.deepEqual(resolveResultGraphHighlight(result, payload, 0, "source"), {
      nodeIds: ["ATL"],
      edgeIds: [],
    });
  });

  test("falls back from a metric cell to the graph-shaped row", () => {
    assert.deepEqual(resolveResultGraphHighlight(result, payload, 0, "dist"), {
      nodeIds: ["ATL", "AUS"],
      edgeIds: ["ATL->AUS"],
    });
  });

  test("supports reverse edge selection by row endpoints", () => {
    assert.deepEqual(
      resultRowsForGraphSelection(result, {
        kind: "edge",
        item: payload.edges[0],
      }),
      [0],
    );
  });

  test("offers node and edge Entity Inspect actions from a result row", () => {
    assert.deepEqual(resultEntityLinks(result, payload, 0), [
      { kind: "node", id: "ATL", label: "Source" },
      { kind: "node", id: "AUS", label: "Target" },
      { kind: "edge", id: "ATL->AUS", label: "Edge" },
    ]);
    assert.deepEqual(
      resolveResultEntitySelection(payload, "edge", "ATL->AUS"),
      { kind: "edge", item: payload.edges[0] },
    );
    assert.equal(
      resolveResultEntitySelection(payload, "node", "missing"),
      undefined,
    );
  });

  test("ignores stale row indexes and missing payloads", () => {
    assert.deepEqual(resolveResultGraphHighlight(result, payload, 4), {
      nodeIds: [],
      edgeIds: [],
    });
    assert.deepEqual(resolveResultGraphHighlight(result, undefined, 0), {
      nodeIds: [],
      edgeIds: [],
    });
  });

  test("normalizes bigint values for webview messages", () => {
    const safe = jsonSafeQueryResult({
      columns: ["count"],
      rows: [{ count: 12n }],
      rowCount: 1,
    });
    assert.equal(safe.rows[0].count, "12");
  });
});
