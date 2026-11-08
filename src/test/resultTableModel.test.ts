import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { nodeLabel } from "../webview/resultGraphModel";
import { entityInspectTitle } from "../webview/entityInspectModel";
import type { GraphPayload, QueryResult } from "../session/types";
import { lazyResultRows } from "../session/resultRows";
import {
  RESULT_INSPECT_BYTES,
  jsonSafeQueryResult,
  resolveResultGraphHighlight,
  resolveResultEntitySelection,
  resultEntityLinks,
  resultEntityLinksByRow,
  resultPageContainsRow,
  resultPageSelection,
  resultMessageMatches,
  resultRowsForGraphSelection,
  resultRowsForGraphSelectionBatched,
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

  test("native membership overrides repeated relationship UUID/endpoints without widening rows", () => {
    const repeated = { ...result, rows: [result.rows[0], result.rows[0]], rowCount: 2 };
    const selection = { kind: "edge" as const, item: payload.edges[0] };
    assert.deepEqual(resultRowsForGraphSelection(repeated, selection), [0, 1]);
    assert.deepEqual(resultRowsForGraphSelection(repeated, selection, [0]), [0]);
    assert.deepEqual(resultRowsForGraphSelection(repeated, selection, []), []);
    assert.deepEqual(resultRowsForGraphSelection(repeated, selection, [-1, 2]), []);
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

suite("bounded result pages", () => {
  test("keeps global row identity and Inspect links on pages after row 500", () => {
    const page = { resultId: "later", columns: result.columns, rows: result.rows, rowCount: 1200, offset: 811, nextOffset: 812 };
    assert.deepEqual(Object.keys(resultEntityLinksByRow(page, payload, page.offset)), ["811"]);
    assert.deepEqual(resultPageSelection(page, new Set([0, 500, 811, 1199])), [811]);
    assert.deepEqual(resultPageSelection(page, new Set()), []);
    assert.equal(resultPageContainsRow(page, 811), true);
    for (const index of [810, 812, -1, 811.5, NaN]) assert.equal(resultPageContainsRow(page, index), false);
  });

  test("rejects actions from replaced results, revisions and pages", () => {
    const current = { resultId: "source-b", revision: 2, pageVersion: 4 };
    assert.equal(resultMessageMatches({ ...current, type: "graphforge/selectResult" }, current), true);
    for (const incoming of [null, {}, { ...current, resultId: "source-a" },
      { ...current, revision: 1 }, { ...current, pageVersion: 3 },
      { ...current, pageVersion: 4.5 }, { ...current, revision: "2" }]) {
      assert.equal(resultMessageMatches(incoming, current), false);
    }
  });

  test("compatibility serialization reads only the bounded first page and excludes IPC", () => {
    let reads = 0;
    const rows = new Proxy(new Array(1200), {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) { reads++; return { id: key }; }
        return Reflect.get(target, key, receiver);
      },
    });
    const page = jsonSafeQueryResult({ columns: ["id"], rows, rowCount: rows.length, ipc: Buffer.from("private-ipc") });
    assert.equal(page.rows.length, 500);
    assert.equal(reads, 500);
    assert.equal(page.rowCount, 1200);
    assert.equal(page.offset, 0);
    assert.equal(page.nextOffset, 500);
    assert.equal("ipc" in page, false);
  });

  test("bounded Inspect stops shared-alias expansion before creating all row links", () => {
    const wide: GraphPayload = { ...payload, edges: [], nodes: Array.from({ length: 200 }, (_, index) =>
      ({ id: `node-${index}`, labels: [], properties: { code: "shared" } })) };
    const rows: QueryResult = { columns: ["id"], rows: [{ id: "shared" }], rowCount: 1 };
    assert.equal(resultEntityLinksByRow(rows, wide)["0"].length, 200);
    assert.throws(() => resultEntityLinksByRow(rows, wide, 0, true), /RESULT_INSPECT_LIMIT/);
    assert.equal(rows.rows[0].id, "shared", "optional Inspect never truncates source values");
  });

  test("bounded Inspect rejects oversized projection and aggregate link metadata", () => {
    const projection: GraphPayload = { ...payload, nodes: [{ ...payload.nodes[0], properties: { note: "x".repeat(RESULT_INSPECT_BYTES) } }] };
    assert.throws(() => resultEntityLinksByRow(result, projection, 0, true), /RESULT_INSPECT_LIMIT/);
    const wide: GraphPayload = { ...payload, edges: [], nodes: Array.from({ length: 9 }, (_, index) =>
      ({ id: `node-${index}`, labels: [], properties: { code: "shared" } })) };
    const rows: QueryResult = { columns: ["id"], rows: Array.from({ length: 500 }, () => ({ id: "shared" })), rowCount: 500 };
    assert.throws(() => resultEntityLinksByRow(rows, wide, 0, true), /RESULT_INSPECT_LIMIT/);
  });

  test("canonical edge Inspect does not depend on a relationship-looking column alias or endpoint nodes", () => {
    const page = { resultId: "edge-only", columns: ["r"], rowCount: 501, offset: 500,
      rows: [{ r: { edge_uuid: "route-1", src_uuid: "ATL", dst_uuid: "AUS", rel_type: "ROUTE" } }] };
    const edgeOnly = { ...payload, nodes: [], edges: [{ ...payload.edges[0], id: "route-1" }] };
    assert.deepEqual(resultEntityLinksByRow(page, edgeOnly, 500, true), {
      "500": [{ kind: "edge", id: "route-1", label: "R" }],
    });
  });

  test("canonical edge UUIDs never expand through another edge's legacy alias", () => {
    const edges = { ...payload, nodes: [], edges: [
      { ...payload.edges[0], id: "route-1" },
      { ...payload.edges[0], id: "other-route", properties: { legacy_id: "route-1" } },
    ] };
    for (const [column, value] of [
      ["r", { edge_uuid: "route-1", src_uuid: "ATL", dst_uuid: "AUS" }],
      ["edge_uuid", "route-1"],
    ] as const) {
      const row = { columns: [column], rows: [{ [column]: value }], rowCount: 1 };
      assert.deepEqual(resultEntityLinks(row, edges, 0).map(link => link.id), ["route-1"]);
      const collisions = { ...edges, edges: [edges.edges[0], ...Array.from({ length: 100 }, (_, index) =>
        ({ ...edges.edges[1], id: `other-${index}` }))] };
      assert.deepEqual(resultEntityLinksByRow(row, collisions, 0, true)["0"].map(link => link.id), ["route-1"]);
    }
    const legacy = { columns: ["rel_id"], rows: [{ rel_id: "route-1" }], rowCount: 1 };
    assert.deepEqual(resultEntityLinks(legacy, edges, 0).map(link => link.id), ["route-1", "other-route"]);
  });

  test("reverse scans yield for costly rows before the row-count ceiling", async () => {
    let reads = 0;
    let current = true;
    const rows = lazyResultRows(50, index => {
      reads++;
      const end = performance.now() + 1;
      while (performance.now() < end) { /* Simulate one costly lazy row. */ }
      return { id: String(index) };
    });
    const cancel = new Promise<void>(resolve => setImmediate(() => { current = false; resolve(); }));
    const selection = await resultRowsForGraphSelectionBatched({ columns: ["id"], rows, rowCount: 50 },
      { kind: "node", item: { id: "missing", labels: [], properties: {} } }, () => current);
    await cancel;
    assert.equal(selection, undefined);
    assert.ok(reads > 0 && reads < 50, "cancellation must run before all costly rows are decoded");
  });

  test("plain selection scan can stop between bounded batches without retaining source rows", async () => {
    let reads = 0;
    let current = true;
    const rows = new Proxy(new Array(1200), {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) { reads++; return { id: key }; }
        return Reflect.get(target, key, receiver);
      },
    });
    const pending = resultRowsForGraphSelectionBatched({ columns: ["id"], rows, rowCount: 1200 },
      { kind: "node", item: { id: "811", labels: [], properties: {} } }, () => current);
    assert.ok(reads > 0 && reads <= 500);
    const beforeCancellation = reads;
    current = false;
    assert.equal(await pending, undefined);
    assert.equal(reads, beforeCancellation);
  });

  test("native membership selects later rows without scanning the source", () => {
    const source: QueryResult = { columns: [], rowCount: 1200, get rows(): never { throw new Error("must not scan"); } };
    const selection = { kind: "edge" as const, item: payload.edges[0] };
    assert.deepEqual(resultRowsForGraphSelection(source, selection, [811, 811, 1199, -1, 1200]), [811, 1199]);
    assert.deepEqual(resultRowsForGraphSelection(source, selection, []), []);
  });
});

suite("entity captions", () => {
  test("uses the airport code instead of the class in inspector headings", () => {
    const node = {
      id: "018f0f4e-7b8c-7000-8000-00000000a001",
      labels: ["Airport"],
      properties: { code: "MHK", city: "Manhattan" },
    };
    assert.equal(nodeLabel(node), "MHK");
    assert.equal(
      entityInspectTitle({ kind: "node", item: node }),
      "Inspect: MHK",
    );
    assert.equal(
      nodeLabel({ ...node, id: "MHK", labels: ["Node"], properties: {} }),
      "MHK",
    );
  });
  test("skips blank captions and keeps class labels out of identity fallback", () => {
    const node = {
      id: "018f0f4e-7b8c-7000-8000-00000000a001",
      labels: ["Node"],
      properties: { name: " ", title: "", label: [], code: "MHK" },
    };
    assert.equal(nodeLabel(node), "MHK");
    assert.equal(nodeLabel({ ...node, properties: {} }), "018f0f4e");
    assert.equal(
      nodeLabel({
        ...node,
        properties: { title: "Airport title", code: "MHK" },
      }),
      "Airport title",
    );
  });
});
