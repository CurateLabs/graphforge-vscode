/**
 * Deterministic fixtures shared by the CodSpeed benchmark suites.
 *
 * Every generator is seeded and allocation-stable so a benchmark measures the
 * code under test rather than the shape of randomly generated input. Sizes are
 * chosen to match realistic Result Graph / Result Table payloads: a Cypher
 * query that returns a few thousand rows is common, a few hundred thousand is
 * not.
 */
import type {
  EpistemicStatus,
  GraphEdge,
  GraphNode,
  GraphPayload,
  QueryResult,
  TableRow,
} from "../session/types";

const STATUSES: EpistemicStatus[] = [
  "supported",
  "hypothesis",
  "disputed",
  "refuted",
  "statusless",
];

const NODE_LABELS = ["Airport", "Region", "Route", "Carrier"];
const EDGE_TYPES = ["ROUTE", "RELATED_TO", "OPERATED_BY"];

/** Small xorshift PRNG so fixtures are identical on every run and machine. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

function uuidLike(prefix: string, index: number): string {
  const hex = index.toString(16).padStart(12, "0");
  return `${prefix}${hex.slice(0, 4)}-${hex.slice(4, 8)}-4${hex.slice(8, 11)}-8${hex.slice(0, 3)}-${hex}`;
}

export function graphPayload(nodeCount: number, edgeCount: number): GraphPayload {
  const random = seededRandom(0x5eed);
  const nodes: GraphNode[] = Array.from({ length: nodeCount }, (_, index) => ({
    id: uuidLike("n", index),
    labels: [NODE_LABELS[index % NODE_LABELS.length]],
    properties: {
      name: `Node ${index}`,
      code: `C${index % 997}`,
      ordinal: index,
      weight: Math.round(random() * 1000) / 10,
    },
    epistemicStatus: STATUSES[index % STATUSES.length],
    ontologyType: index % 4 === 0 ? "gf:Airport" : undefined,
  }));
  const edges: GraphEdge[] = Array.from({ length: edgeCount }, (_, index) => ({
    id: uuidLike("e", index),
    type: EDGE_TYPES[index % EDGE_TYPES.length],
    source: nodes[index % nodeCount].id,
    target: nodes[(index * 17 + 11) % nodeCount].id,
    epistemicStatus: STATUSES[(index + 2) % STATUSES.length],
    properties: { rel_code: `R${index % 499}`, distance: index % 3_000 },
  }));
  return {
    nodes,
    edges,
    legend: { statuses: [...STATUSES], types: [...EDGE_TYPES] },
    title: "Benchmark graph",
    styleMode: "epistemic",
  };
}

/**
 * A tabular result whose identity columns resolve against `payload`, which is
 * the case the Result Table cross-highlighting code is optimized for.
 */
export function graphQueryResult(payload: GraphPayload, rowCount: number): QueryResult {
  const columns = ["node_uuid", "edge_uuid", "source", "target", "name", "score"];
  const rows: TableRow[] = Array.from({ length: rowCount }, (_, index) => {
    const edge = payload.edges[index % payload.edges.length];
    return {
      node_uuid: edge.source,
      edge_uuid: edge.id,
      source: edge.source,
      target: edge.target,
      name: `Row ${index}`,
      score: (index % 97) / 7,
    };
  });
  return { columns, rows, rowCount: rows.length };
}

/** A plain analytics result with no graph identity columns. */
export function tabularQueryResult(rowCount: number, columnCount: number): QueryResult {
  const random = seededRandom(0xc0de);
  const columns = Array.from({ length: columnCount }, (_, index) =>
    index === 0 ? "carrier" : `metric_${index}`,
  );
  const rows: TableRow[] = Array.from({ length: rowCount }, (_, rowIndex) => {
    const row: TableRow = {};
    for (const [columnIndex, column] of columns.entries()) {
      row[column] =
        columnIndex === 0
          ? `carrier-${rowIndex % 12}`
          : Math.round(random() * 100_000) / 100;
    }
    return row;
  });
  return { columns, rows, rowCount: rows.length };
}

/** Same shape as `tabularQueryResult`, with bigints the webview cannot carry. */
export function bigintQueryResult(rowCount: number): QueryResult {
  const columns = ["carrier", "flights", "passengers"];
  const rows: TableRow[] = Array.from({ length: rowCount }, (_, index) => ({
    carrier: `carrier-${index % 12}`,
    flights: BigInt(index * 31),
    passengers: BigInt(index) * 1_000n,
  }));
  return { columns, rows, rowCount: rows.length };
}
