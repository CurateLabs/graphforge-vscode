import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { decodeTable } from "../session/arrowCodec";
import { formatQueryResultJson } from "../session/resultDocument";
import {
  MAX_PROJECTED_ENTITIES,
  projectResultGraph,
  ResultProjectionError,
  sourceMismatch,
} from "../session/resultProjection";
import {
  classifyResult,
  parseResultProvenance,
  parseResultSchema,
} from "../session/resultSchemas";
import type { GraphPayload, QueryResult } from "../session/types";
import {
  resolveResultGraphHighlight,
  resultEntityLinksByRow,
  resultRowsForGraphSelection,
} from "../webview/resultTableModel";

/**
 * Fixtures are raw Arrow IPC bytes produced by `@curatelabs/graphforge`
 * (see scripts/generate-result-fixtures.cjs), not hand-built tables.
 */
const FIXTURES = path.resolve(__dirname, "fixtures", "graphforge-results");

interface Manifest {
  graphforgeVersion: string;
  contracts: { verb: string; algorithm: string; resultSchemaVersion: number }[];
  fixtures: Record<string, { verb: string; algorithm?: string; base?: string }>;
  failures: Record<string, string>;
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, "manifest.json"), "utf8"),
) as Manifest;

function fixture(name: string, resultId = `result-${name}`): QueryResult {
  const result = decodeTable(fs.readFileSync(path.join(FIXTURES, `${name}.arrow`)));
  return { ...result, provenance: { resultId, generationUuid: "generation-1" } };
}

function projectionCode(result: QueryResult): string | undefined {
  try {
    projectResultGraph(result);
    return undefined;
  } catch (err) {
    assert.ok(err instanceof ResultProjectionError, String(err));
    return err.code;
  }
}

function payloadFor(result: QueryResult): GraphPayload {
  const projection = projectResultGraph(result);
  return {
    nodes: projection.nodes,
    edges: projection.edges,
    legend: { statuses: [], types: [] },
    styleMode: "class-only",
    source: projection.source,
    rowEntities: projection.rowEntities,
  };
}

suite("Result routing (#80)", () => {
  test("fixtures were produced by a real engine run with no skipped algorithms", () => {
    assert.match(manifest.graphforgeVersion, /^\d+\.\d+\.\d+/);
    assert.deepEqual(manifest.failures, {});
    assert.equal(manifest.contracts.length, 94);
  });

  test("every algorithm and find result routes to XYG from engine metadata, never to the Result Graph", () => {
    for (const name of [...manifest.contracts.map((c) => c.algorithm), "find"]) {
      const result = fixture(name);
      const classification = classifyResult(result.columns, result.schema);
      assert.equal(classification.entry.id, "xyg-layer", name);
      assert.equal(projectionCode(result), "GF_RESULT_XYG_LAYER", name);
    }
  });

  test("Cypher and schema() fixtures have explicit Result Graph dispositions", () => {
    assert.equal(classifyResult(fixture("cypher-nodes").columns, fixture("cypher-nodes").schema).entry.id, "cypher-entities");
    assert.equal(projectionCode(fixture("cypher-edges")), undefined);
    assert.equal(projectionCode(fixture("cypher-paths")), undefined);
    assert.equal(projectionCode(fixture("base-cyclic-nodes")), undefined);
    assert.equal(projectionCode(fixture("cypher-scalars")), "GF_RESULT_NO_IDENTITY");
    assert.equal(projectionCode(fixture("schema")), "GF_RESULT_NO_IDENTITY");
  });
});

suite("Typed Arrow decoding (#80)", () => {
  test("preserves field types and GraphForge schema metadata", () => {
    const result = fixture("pagerank");
    assert.equal(result.algorithm, "pagerank");
    assert.equal(result.schema?.metadata["graphforge.verb"], "rank");
    assert.equal(result.schema?.metadata["graphforge.algorithm_schema_version"], "1");
    const [nodeUuid, score] = result.schema!.fields;
    assert.deepEqual(nodeUuid, { name: "node_uuid", type: { kind: "uuid" }, nullable: false });
    assert.deepEqual(score.type, { kind: "float" });
    assert.match(String(result.rows[0].node_uuid), /^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  });

  test("keeps ordered UUID lists and fixed-size embedding vectors", () => {
    const paths = fixture("bfs");
    const pathField = paths.schema!.fields.find((f) => f.name === "path");
    assert.deepEqual(pathField?.type, { kind: "uuid-list" });
    const path0 = paths.rows[0].path as string[];
    assert.ok(Array.isArray(path0) && path0.length >= 2);
    assert.equal(path0[0], paths.rows[0].source_uuid);
    assert.equal(path0.at(-1), paths.rows[0].target_uuid);

    const embedding = fixture("fast_random_projection");
    const vector = embedding.schema!.fields.find((f) => f.name === "embedding");
    assert.deepEqual(vector?.type, { kind: "float-vector", dimensions: 4 });
    assert.equal((embedding.rows[0].embedding as number[]).length, 4);
    assert.equal(embedding.schema?.metadata["graphforge.dimensions"], "4");
  });

  test("decodes Cypher entity structs into plain objects with UUID identity", () => {
    const result = fixture("cypher-edges");
    const edge = result.rows[0].r as Record<string, unknown>;
    assert.equal(typeof edge.edge_uuid, "string");
    assert.equal(edge.src_uuid, (result.rows[0].a as Record<string, unknown>).node_uuid);
    assert.equal(edge.dst_uuid, (result.rows[0].b as Record<string, unknown>).node_uuid);
    assert.equal(edge.rel_type, "KNOWS");
    assert.deepEqual((result.rows[0].a as Record<string, unknown>).labels, ["Person"]);
  });
});

suite("Schema-aware graph projection (#80)", () => {
  test("canonical Cypher edges keep node/edge UUIDs, types, and row identity", () => {
    const result = fixture("cypher-edges");
    const projection = projectResultGraph(result);
    assert.equal(projection.edges.length, result.rowCount);
    for (const [index, row] of result.rows.entries()) {
      const r = row.r as Record<string, unknown>;
      const edge = projection.edges.find((e) => e.id === r.edge_uuid);
      assert.ok(edge);
      assert.equal(edge.source, r.src_uuid);
      assert.equal(edge.target, r.dst_uuid);
      assert.equal(edge.type, "KNOWS");
      assert.equal(edge.derived, undefined);
      assert.deepEqual(projection.rowEntities[index].edgeIds, [r.edge_uuid]);
      assert.ok(projection.rowEntities[index].nodeIds.includes(String(r.src_uuid)));
    }
    const node = projection.nodes[0];
    assert.deepEqual(node.labels, ["Person"]);
    assert.equal(typeof node.properties.name, "string");
    assert.equal(projection.source.schemaId, "cypher-entities");
    assert.equal(projection.source.resultId, "result-cypher-edges");
    assert.equal(projection.source.generationUuid, "generation-1");
  });

  test("Cypher path structs contribute every node and persisted relationship", () => {
    const result = fixture("cypher-paths");
    const projection = projectResultGraph(result);
    for (const entities of projection.rowEntities) {
      assert.equal(entities.nodeIds.length, 3);
      assert.equal(entities.edgeIds.length, 2);
    }
    assert.ok(projection.edges.every((edge) => edge.derived === undefined));
  });

  test("projection is bounded", () => {
    assert.ok(MAX_PROJECTED_ENTITIES > 0);
    assert.throws(
      () => projectResultGraph(fixture("cypher-edges"), { maxEntities: 2 }),
      (err: unknown) => err instanceof ResultProjectionError && err.code === "GF_RESULT_TOO_LARGE",
    );
  });

  test("a saved result projects identically after its JSON document round-trips", () => {
    const result = fixture("cypher-paths");
    const saved = JSON.parse(formatQueryResultJson(result)) as Record<string, unknown>;
    const restored: QueryResult = {
      columns: saved.columns as string[],
      rows: saved.rows as QueryResult["rows"],
      rowCount: saved.rowCount as number,
      schema: parseResultSchema(saved.schema, "saved"),
      provenance: parseResultProvenance(saved.provenance, "saved"),
    };
    const withoutTiming = (r: QueryResult) => {
      const { diagnostic, ...projection } = projectResultGraph(r);
      return { ...projection, diagnostic: { ...diagnostic, durationMs: 0 } };
    };
    assert.deepEqual(withoutTiming(restored), withoutTiming(result));
    assert.throws(() => parseResultSchema({ fields: [{ name: "x" }], metadata: {} }, "bad"));
    assert.throws(() => parseResultProvenance({ generationUuid: "g" }, "bad"));
  });
});

suite("Identity-based selection linking (#80)", () => {
  test("table → graph uses the row's projected UUIDs, narrowed to the clicked cell", () => {
    const result = fixture("cypher-edges");
    const payload = payloadFor(result);
    const row = result.rows[1];
    const a = row.a as Record<string, unknown>;
    const r = row.r as Record<string, unknown>;
    assert.deepEqual(resolveResultGraphHighlight(result, payload, 1, "a"), {
      nodeIds: [a.node_uuid],
      edgeIds: [],
    });
    const whole = resolveResultGraphHighlight(result, payload, 1);
    assert.deepEqual(whole.edgeIds, [r.edge_uuid]);
    assert.equal(whole.nodeIds.length, 2);
  });

  test("graph → table finds rows by UUID, independent of row position", () => {
    const result = fixture("cypher-edges");
    const payload = payloadFor(result);
    const target = payload.edges[2];
    const rows = resultRowsForGraphSelection(result, { kind: "edge", item: target }, payload);
    assert.deepEqual(
      rows,
      result.rows.flatMap((row, i) => ((row.r as Record<string, unknown>).edge_uuid === target.id ? [i] : [])),
    );
    const reversed: QueryResult = { ...result, rows: [...result.rows].reverse() };
    const reversedPayload = payloadFor(reversed);
    const reversedRows = resultRowsForGraphSelection(reversed, { kind: "edge", item: target }, reversedPayload);
    assert.equal((reversed.rows[reversedRows[0]].r as Record<string, unknown>).edge_uuid, target.id);
  });

  test("entity links are labelled by the column carrying each UUID", () => {
    const result = fixture("cypher-edges");
    const links = resultEntityLinksByRow(result, payloadFor(result))["0"];
    assert.deepEqual(
      links.map((l) => `${l.kind}:${l.label}`).sort(),
      ["edge:R", "node:A", "node:B"],
    );
  });

  test("stale or foreign sources are rejected before joining", () => {
    const result = fixture("cypher-edges", "result-a");
    const payload = payloadFor(result);
    assert.equal(sourceMismatch(payload.source, result), undefined);
    assert.ok(sourceMismatch(payload.source, { ...result, provenance: { resultId: "result-b", generationUuid: "generation-1" } }));
    assert.ok(sourceMismatch(payload.source, { ...result, provenance: { resultId: "result-a", generationUuid: "generation-2" } }));
    assert.ok(sourceMismatch(payload.source, { ...result, provenance: undefined }));
    assert.equal(sourceMismatch(undefined, { ...result, provenance: undefined }), undefined);
  });
});
