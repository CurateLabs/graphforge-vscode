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

suite("GraphForgeSession result generation", () => {
  test("closing a project releases its native handle before returning", async () => {
    const session = new GraphForgeSession();
    let closed = 0;
    injectForge(session, makeStubForge({ close: () => { closed++; } }));
    try {
      await session.closeProject();
      assert.equal(closed, 1);
      await session.closeProject();
      assert.equal(closed, 1, "An already detached backend is not closed again");
    } finally { session.dispose(); }
  });

  for (const method of ["execute", "rank"] as const) {
    test(`${method} retains the read generation across a concurrent mutation`, async () => {
      const session = new GraphForgeSession();
      const first = Buffer.from("0190a000000070008000000000000001", "hex");
      const second = Buffer.from("0190a000000070008000000000000002", "hex");
      let generation = first;
      const ipc = () => encodeSimpleTable(["name"], [{ name: "fixture" }]);
      injectForge(session, makeStubForge({
        execute: (query) => { if (query === "mutate") generation = second; return ipc(); },
        rank: ipc,
        committedGenerationIdentity: () => ({ generationUuid: generation, manifestSha256: Buffer.alloc(32) }),
      }));
      try {
        const pending = method === "execute" ? session.execute("read") : session.invokeVerb("rank", {});
        await session.executeMutation("mutate");
        const result = await pending;
        assert.equal(result.generationUuid, "0190a000-0000-7000-8000-000000000001");
        assert.equal(session.getLastResult(), result);
      } finally { session.dispose(); }
    });

    test(`${method} rejects a read from a replaced backend without remembering it`, async () => {
      const session = new GraphForgeSession();
      const ipc = () => encodeSimpleTable(["name"], [{ name: "fixture" }]);
      injectForge(session, makeStubForge({ execute: ipc, rank: ipc }));
      try {
        const pending = method === "execute" ? session.execute("read") : session.invokeVerb("rank", {});
        injectForge(session, makeStubForge());
        await assert.rejects(pending, (error: unknown) => (error as { code?: string }).code === "SESSION_CHANGED");
        assert.equal(session.getLastResult(), undefined);
      } finally { session.dispose(); }
    });
  }
});

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

  test("empty results stay empty without fabricated graph entities", async () => {
    const session = new GraphForgeSession();
    const payload = await session.toGraphPayload({ columns: [], rows: [], rowCount: 0 });
    assert.equal(payload.styleMode, "class-only");
    assert.equal(payload.nodes.length, 0);
    session.dispose();
  });

  test("canonical entity inspection preserves airport properties and UUIDs", async () => {
    const session = new GraphForgeSession();
    injectForge(session, makeStubForge());
    injectCapabilities(session, []);
    const source = "018f0f4e-7b8c-7000-8000-00000000a001",
      target = "018f0f4e-7b8c-7000-8000-00000000a002",
      edge = "018f0f4e-7b8c-7000-8000-00000000a003";
    try {
      const payload = await session.toGraphPayload({
        columns: ["a", "r", "b", "source", "target"],
        rowCount: 1,
        rows: [
          {
            a: {
              node_uuid: source,
              labels: ["Airport"],
              code: "MHK",
              city: "Manhattan",
              lon: -96.6707992553711,
            },
            r: {
              edge_uuid: edge,
              src_uuid: source,
              dst_uuid: target,
              rel_type: "ROUTE",
              dist: 500,
            },
            b: { node_uuid: target, labels: ["Airport"], code: "ORD" },
            source: "MHK",
            target: "ORD",
          },
        ],
      });
      assert.deepEqual(payload.nodes.map((node) => node.id).sort(), [
        source,
        target,
      ]);
      assert.deepEqual(
        payload.nodes.find((node) => node.id === source)?.properties,
        { code: "MHK", city: "Manhattan", lon: -96.6707992553711 },
      );
      assert.equal(payload.edges[0].id, edge);
      assert.equal(payload.edges[0].properties?.dist, 500);
    } finally {
      session.dispose();
    }
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

suite("GraphForgeSession.knowledgeSummary status counts", () => {
  /** Ledger fixture covering the full epistemic model: six explicit statuses + one statusless. */
  const LEDGER: Array<{ uuid: string; status?: string }> = [
    { uuid: "a1", status: "hypothesis" },
    { uuid: "a2", status: "supported" },
    { uuid: "a3", status: "refuted" },
    { uuid: "a4", status: "disputed" },
    { uuid: "a5", status: "retracted" },
    { uuid: "a6", status: "superseded" },
    { uuid: "a7" }, // no status event recorded → statusless
  ];

  const listAssertionsStub = async () =>
    encodeSimpleTable(
      ["assertion_uuid", "claim"],
      LEDGER.map((a) => ({ assertion_uuid: a.uuid, claim: `claim ${a.uuid}` })),
    );

  const assertionStatusStub = async (assertionUuid: string) => {
    const status = LEDGER.find((a) => a.uuid === assertionUuid)?.status;
    return encodeSimpleTable(
      status ? ["status"] : [],
      status ? [{ status }] : [],
    );
  };

  test("aggregates real per-assertion statuses across the full model", async () => {
    const session = new GraphForgeSession();
    injectForge(
      session,
      makeStubForge({
        listAssertions: listAssertionsStub,
        assertionStatus: assertionStatusStub,
      }),
    );
    const summary = await session.knowledgeSummary();
    assert.equal(summary.capabilityAvailable, true);
    assert.equal(summary.statusAvailable, true);
    assert.deepEqual(summary.statusCounts, {
      hypothesis: 1,
      supported: 1,
      refuted: 1,
      disputed: 1,
      retracted: 1,
      superseded: 1,
      statusless: 1,
    });
    assert.equal(
      summary.assertions.find((a) => a.assertionUuid === "a2")?.status,
      "supported",
    );
    assert.equal(
      summary.assertions.find((a) => a.assertionUuid === "a7")?.status,
      "statusless",
    );
    session.dispose();
  });

  test("degrades honestly when the binding lacks assertionStatus()", async () => {
    const session = new GraphForgeSession();
    injectForge(session, makeStubForge({ listAssertions: listAssertionsStub }));
    const summary = await session.knowledgeSummary();
    assert.equal(summary.capabilityAvailable, true);
    assert.equal(summary.statusAvailable, false);
    assert.deepEqual(summary.statusCounts, {});
    assert.ok(summary.statusNote?.includes("assertionStatus"));
    // Assertions still list — only the statuses are unavailable.
    assert.equal(summary.assertions.length, LEDGER.length);
    for (const assertion of summary.assertions) {
      assert.equal(assertion.status, undefined);
    }
    session.dispose();
  });

  test("degrades honestly when the binding lacks listAssertions()", async () => {
    const session = new GraphForgeSession();
    injectForge(session, makeStubForge());
    const summary = await session.knowledgeSummary();
    assert.equal(summary.statusAvailable, false);
    assert.deepEqual(summary.statusCounts, {});
    assert.equal(summary.assertions.length, 0);
    assert.ok(summary.note?.includes("listAssertions"));
    session.dispose();
  });

  test("getAssertion detail includes the current explicit status", async () => {
    const session = new GraphForgeSession();
    injectForge(
      session,
      makeStubForge({
        listAssertions: listAssertionsStub,
        assertionStatus: assertionStatusStub,
      }),
    );
    const supported = await session.getAssertion("a2");
    assert.equal(supported?.status, "supported");
    const statusless = await session.getAssertion("a7");
    assert.equal(statusless?.status, "statusless");
    session.dispose();
  });

  test("getAssertion detail names status unavailability instead of omitting it", async () => {
    const session = new GraphForgeSession();
    injectForge(session, makeStubForge({ listAssertions: listAssertionsStub }));
    const row = await session.getAssertion("a2");
    assert.equal(row?.status, undefined);
    assert.ok(String(row?.statusNote).includes("assertionStatus"));
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
