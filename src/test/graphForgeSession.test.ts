import * as assert from "node:assert/strict";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import { GraphForgeSession } from "../session/graphForgeSession";
import { NodeEngineBackend } from "../session/nodeEngineBackend";
import type {
  AlgorithmDescriptorContract,
  EngineBackend,
  GraphForgeNative,
  QueryResult,
} from "../session/types";

/** Minimal stub satisfying the bits of GraphForgeNative each test needs. */
function makeStubForge(overrides: Partial<GraphForgeNative> = {}): GraphForgeNative {
  return {
    path: "/tmp/fake-project",
    ontologyMode: "exploratory",
    execute: () => Buffer.alloc(0),
    rank: () => Buffer.alloc(0),
    cluster: () => Buffer.alloc(0),
    paths: () => Buffer.alloc(0),
    analyze: () => Buffer.alloc(0),
    similar: () => Buffer.alloc(0),
    find: () => Buffer.alloc(0),
    labels: () => [],
    relationshipTypes: () => [],
    loadOntology: () => undefined,
    ...overrides,
  };
}

/**
 * Reach past private fields for test injection — session has no test-only
 * constructor. Wraps the stub `GraphForgeNative` in a `NodeEngineBackend`
 * since the session now talks to the runtime-agnostic `EngineBackend` facade
 * (#12) rather than a raw native handle.
 */
function injectForge(session: GraphForgeSession, forge: GraphForgeNative): void {
  (session as unknown as { backend: EngineBackend }).backend = new NodeEngineBackend(forge);
}

function injectCapabilities(session: GraphForgeSession, capabilities: string[]): void {
  (session as unknown as { activeProject: unknown }).activeProject = {
    rootPath: "/tmp/fake-project",
    name: "fake-project",
  };
  session.capabilities = () => ({ capabilities });
}

suite("GraphForgeSession.algorithmCatalog", () => {
  test("falls back to static list when binding has no forge open", () => {
    const session = new GraphForgeSession();
    const catalog = session.algorithmCatalog("rank");
    assert.equal(catalog.source, "fallback");
    assert.ok(catalog.items.includes("pagerank"));
    session.dispose();
  });

  test("falls back when forge predates algorithmDescriptorContracts", () => {
    const session = new GraphForgeSession();
    injectForge(session, makeStubForge());
    const catalog = session.algorithmCatalog("cluster");
    assert.equal(catalog.source, "fallback");
    assert.ok(catalog.items.includes("louvain"));
    session.dispose();
  });

  test("uses live contracts filtered + deduped by verb when available", () => {
    const session = new GraphForgeSession();
    const contracts: AlgorithmDescriptorContract[] = [
      { verb: "rank", algorithm: "pagerank", algorithmVersion: 2, resultSchemaVersion: 1 },
      { verb: "rank", algorithm: "pagerank", algorithmVersion: 2, resultSchemaVersion: 1 },
      { verb: "rank", algorithm: "custom_rank", algorithmVersion: 1, resultSchemaVersion: 1 },
      { verb: "cluster", algorithm: "louvain", algorithmVersion: 1, resultSchemaVersion: 1 },
    ];
    injectForge(
      session,
      makeStubForge({ algorithmDescriptorContracts: () => contracts }),
    );
    const catalog = session.algorithmCatalog("rank");
    assert.equal(catalog.source, "contracts");
    assert.deepEqual(catalog.items, ["pagerank", "custom_rank"]);
    session.dispose();
  });

  test("falls back with a note when contracts() throws", () => {
    const session = new GraphForgeSession();
    injectForge(
      session,
      makeStubForge({
        algorithmDescriptorContracts: () => {
          throw new Error("boom");
        },
      }),
    );
    const catalog = session.algorithmCatalog("rank");
    assert.equal(catalog.source, "fallback");
    assert.equal(catalog.note, "boom");
    session.dispose();
  });

  test("falls back with a note when contracts() returns nothing for this verb", () => {
    const session = new GraphForgeSession();
    injectForge(
      session,
      makeStubForge({
        algorithmDescriptorContracts: () => [
          { verb: "cluster", algorithm: "louvain", algorithmVersion: 1, resultSchemaVersion: 1 },
        ],
      }),
    );
    const catalog = session.algorithmCatalog("rank");
    assert.equal(catalog.source, "fallback");
    assert.ok(catalog.note?.includes("no contracts"));
    session.dispose();
  });
});

suite("GraphForgeSession.toGraphPayload styling", () => {
  const graphResult: QueryResult = {
    columns: ["source", "target", "type"],
    rows: [{ source: "n1", target: "n2", type: "KNOWS" }],
    rowCount: 1,
  };

  test("demo styling when result has no graph-shaped rows", async () => {
    const session = new GraphForgeSession();
    const payload = await session.toGraphPayload({ columns: [], rows: [], rowCount: 0 });
    assert.equal(payload.styleMode, "demo");
    assert.ok(payload.nodes.length > 0);
    session.dispose();
  });

  test("class-only styling with no fake statuses when knowledge capability is absent", async () => {
    const session = new GraphForgeSession();
    injectForge(session, makeStubForge());
    injectCapabilities(session, []);
    const payload = await session.toGraphPayload(graphResult, "t");
    assert.equal(payload.styleMode, "class-only");
    for (const node of payload.nodes) {
      assert.equal(node.epistemicStatus, undefined);
    }
    for (const edge of payload.edges) {
      assert.equal(edge.epistemicStatus, undefined);
    }
    assert.ok(payload.banner?.includes("Knowledge capability"));
    session.dispose();
  });

  test("class-only styling when capability present but binding lacks status APIs", async () => {
    const session = new GraphForgeSession();
    injectForge(session, makeStubForge());
    injectCapabilities(session, ["knowledge", "epistemic"]);
    const payload = await session.toGraphPayload(graphResult, "t");
    assert.equal(payload.styleMode, "class-only");
    assert.ok(payload.banner?.includes("belief/status APIs"));
    session.dispose();
  });

  test("epistemic styling resolves real ledger status per node", async () => {
    const session = new GraphForgeSession();
    injectForge(
      session,
      makeStubForge({
        listAssertions: async ({ graphUuid } = {}) => {
          const hasAssertion = graphUuid === "n1";
          return encodeSimpleTable(
            hasAssertion ? ["assertion_uuid"] : [],
            hasAssertion ? [{ assertion_uuid: "a1" }] : [],
          );
        },
        assertionStatus: async () => encodeSimpleTable(["status"], [{ status: "supported" }]),
      }),
    );
    injectCapabilities(session, ["knowledge", "epistemic"]);
    const payload = await session.toGraphPayload(graphResult, "t");
    assert.equal(payload.styleMode, "epistemic");
    const n1 = payload.nodes.find((n) => n.id === "n1");
    const n2 = payload.nodes.find((n) => n.id === "n2");
    assert.equal(n1?.epistemicStatus, "supported");
    assert.equal(n2?.epistemicStatus, "statusless");
    session.dispose();
  });

  test("class-only styling when belief policy is disabled", async () => {
    const session = new GraphForgeSession();
    injectForge(
      session,
      makeStubForge({
        listAssertions: async () => encodeSimpleTable([], []),
        assertionStatus: async () => encodeSimpleTable([], []),
      }),
    );
    injectCapabilities(session, ["knowledge", "epistemic"]);
    session.setBeliefPolicy({ enabled: false });
    const payload = await session.toGraphPayload(graphResult, "t");
    assert.equal(payload.styleMode, "class-only");
    assert.ok(payload.banner?.includes("disabled"));
    session.dispose();
  });
});

/** Encodes a tiny Arrow IPC table from plain string-valued rows, matching decodeTable's expectations. */
function encodeSimpleTable(columns: string[], rows: Record<string, string>[]): Buffer {
  const arrays: Record<string, string[]> = {};
  for (const col of columns) {
    arrays[col] = rows.map((r) => r[col]);
  }
  const table = tableFromArrays(arrays);
  return Buffer.from(tableToIPC(table));
}
