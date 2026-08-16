/**
 * Result Table <-> Result Graph cross-linking. Every one of these runs on the
 * extension host each time a query finishes or a cell is clicked, over the full
 * result set, so they scale with row count.
 */
import type { Bench } from "tinybench";
import {
  jsonSafeQueryResult,
  resolveResultEntitySelection,
  resolveResultGraphHighlight,
  resultEntityLinks,
  resultEntityLinksByRow,
  resultRowsForGraphSelection,
} from "../webview/resultTableModel";
import { bigintQueryResult, graphPayload, graphQueryResult, tabularQueryResult } from "./fixtures";

export function registerResultTableBenchmarks(bench: Bench): void {
  const payload = graphPayload(2_000, 4_000);
  const result = graphQueryResult(payload, 2_000);
  const nodeSelection = { kind: "node" as const, item: payload.nodes[977] };
  const edgeSelection = { kind: "edge" as const, item: payload.edges[1_733] };
  const tabular = tabularQueryResult(5_000, 8);
  const bigints = bigintQueryResult(5_000);

  bench.add("resultTableModel: entity links for every row (2k rows)", () => {
    resultEntityLinksByRow(result, payload);
  });

  bench.add("resultTableModel: entity links for one row", () => {
    resultEntityLinks(result, payload, 1_234);
  });

  bench.add("resultTableModel: highlight from a clicked cell", () => {
    resolveResultGraphHighlight(result, payload, 1_234, "edge_uuid");
  });

  bench.add("resultTableModel: highlight from a clicked row", () => {
    resolveResultGraphHighlight(result, payload, 1_234);
  });

  bench.add("resultTableModel: rows for a node selection (2k rows)", () => {
    resultRowsForGraphSelection(result, nodeSelection);
  });

  bench.add("resultTableModel: rows for an edge selection (2k rows)", () => {
    resultRowsForGraphSelection(result, edgeSelection);
  });

  bench.add("resultTableModel: resolve entity selection by id", () => {
    resolveResultEntitySelection(payload, "node", payload.nodes[1_500].id);
    resolveResultEntitySelection(payload, "edge", payload.edges[3_500].id);
  });

  bench.add("resultTableModel: JSON-safe result (5k rows x 8 cols)", () => {
    jsonSafeQueryResult(tabular);
  });

  bench.add("resultTableModel: JSON-safe result with bigints (5k rows)", () => {
    jsonSafeQueryResult(bigints);
  });
}
