import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
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

  test("closing awaits a deferred backend disposal before a new writer can run", async () => {
    const session = new GraphForgeSession();
    let release!: () => void;
    let started = false;
    let complete = false;
    (session as unknown as { backend: Partial<EngineBackend> }).backend = {
      dispose: () => { started = true; return new Promise<void>(resolve => { release = resolve; }); },
    };
    const pending = session.closeProject().then(() => { complete = true; });
    try {
      await Promise.resolve();
      assert.equal(started, true);
      assert.equal(complete, false);
      release();
      await pending;
      assert.equal(complete, true);
    } finally { session.dispose(); }
  });

  test("concurrent closes both await the same retiring writer", async () => {
    const session = new GraphForgeSession();
    let release!: () => void;
    let disposals = 0;
    let secondComplete = false;
    (session as unknown as { backend: Partial<EngineBackend> }).backend = {
      dispose: () => { disposals++; return new Promise<void>(resolve => { release = resolve; }); },
    };
    const first = session.closeProject();
    const second = session.closeProject().then(() => { secondComplete = true; });
    try {
      await Promise.resolve(); await Promise.resolve();
      assert.equal(secondComplete, false, "another close must not release recovery before writer exit");
      assert.equal(disposals, 1);
    } finally { release(); await Promise.all([first, second]); session.dispose(); }
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

suite("GraphForgeSession lifecycle ordering", () => {
  let session: GraphForgeSession;
  let root: string;
  const project = { rootPath: "/old/project", name: "old" };
  const backend = (dispose: () => Promise<void>) => Object.assign(new NodeEngineBackend(makeStubForge()), { dispose });
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
  };
  setup(async function () {
    session = new GraphForgeSession();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "gf-lifecycle-"));
    if (!await session.hasUsableRuntime()) {
      if (process.env.GRAPHFORGE_REQUIRE_NATIVE) assert.fail("A runtime is required for installation acceptance");
      this.skip();
    }
    (session as unknown as { activeProject: unknown }).activeProject = project;
  });
  teardown(async () => {
    session.dispose();
    await session.closeProject().catch(() => {}); // Failure is asserted by the owning test.
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("failed shutdown reaches concurrent closes and prevents later opens", async () => {
    const started = deferred(), release = deferred();
    const failure = Object.assign(new Error("writer still alive"), { code: "PYTHON_SHUTDOWN_UNCONFIRMED" });
    let disposals = 0;
    (session as unknown as { backend: EngineBackend }).backend = backend(async () => {
      disposals++; started.resolve(); await release.promise; throw failure;
    });
    const first = assert.rejects(session.closeProject(), error => error === failure);
    const second = assert.rejects(session.closeProject(), error => error === failure);
    await started.promise;
    release.resolve();
    await Promise.all([first, second]);
    await assert.rejects(session.closeProject(), error => error === failure);
    await assert.rejects(session.initializeProject(root), error => error === failure);
    assert.equal(disposals, 1);
    assert.deepEqual(fs.readdirSync(root), [], "a failed shutdown must prevent even preparing another writer");
  });

  for (const fails of [false, true]) {
    test(`replacement awaits previous shutdown${fails ? " and fails closed on rejection" : " before exposing its backend"}`, async () => {
      const started = deferred(), release = deferred();
      const failure = new Error("shutdown refused");
      let disposals = 0;
      (session as unknown as { backend: EngineBackend }).backend = backend(async () => {
        disposals++; started.resolve(); await release.promise; if (fails) throw failure;
      });
      const pending = session.initializeProject(root);
      const outcome = fails ? assert.rejects(pending, error => error === failure) : pending;
      await started.promise;
      assert.equal(session.project, undefined);
      assert.equal(session.activeRuntime, undefined);
      release.resolve();
      await outcome;
      assert.equal(disposals, 1);
      if (fails) {
        await assert.rejects(session.initializeProject(root), error => error === failure);
        // The prepared candidate was closed after the previous shutdown failed.
        const probe = new GraphForgeSession();
        try { await probe.openProject(root); }
        finally { await probe.closeProject(); probe.dispose(); }
      } else {
        assert.equal((session.project as { rootPath: string } | undefined)?.rootPath, root);
        await session.closeProject();
      }
    });
  }

  test("latest attachment wins and close waits for cancelled attachment cleanup", async () => {
    const other = path.join(root, "other");
    fs.mkdirSync(other);
    const first = assert.rejects(session.initializeProject(path.join(root, "first")), error => (error as { code?: string }).code === "SESSION_CHANGED");
    const second = session.initializeProject(other);
    await Promise.all([first, second]);
    assert.equal(session.project?.rootPath, other);
    await session.closeProject();
    assert.equal(session.project, undefined);
  });

  test("preparation failure preserves the current backend and project", async () => {
    let disposals = 0;
    (session as unknown as { backend: EngineBackend }).backend = backend(async () => { disposals++; });
    fs.writeFileSync(path.join(root, "foreign.txt"), "Do not initialize this directory");
    await assert.rejects(session.initializeProject(root));
    assert.equal(session.project, project);
    assert.equal(session.activeRuntime, "node");
    assert.equal(disposals, 0);
    await session.closeProject();
  });
});

suite("GraphForgeSession bounded command pages", () => {
  test("pages an exposed result without rerunning and rejects replaced or closed results", async () => {
    const session = new GraphForgeSession();
    let executions = 0;
    injectForge(session, makeStubForge({ execute: () => {
      executions++;
      return Buffer.from(tableToIPC(tableFromArrays({ value: Int32Array.from({ length: 1203 }, (_, index) => index) })));
    } }));
    try {
      const result = await session.execute("fixture");
      const first = session.resultPage(result);
      assert.equal(first.rows.length, 500);
      assert.equal(first.nextOffset, 500);
      assert.ok(!("ipc" in first));
      const second = session.readResultPage({ resultId: first.resultId, offset: first.nextOffset });
      assert.equal(second.rows[0].value, 500);
      assert.equal(executions, 1);
      await session.execute("replacement");
      assert.throws(() => session.readResultPage({ resultId: first.resultId }), /RESULT_PAGE_STALE/);
      const original = session.getLastResult()!;
      const replacedBackendPage = session.resultPage(original);
      injectForge(session, makeStubForge());
      assert.throws(() => session.readResultPage({ resultId: replacedBackendPage.resultId }), /RESULT_PAGE_STALE/);
      assert.throws(() => session.resultPage(original), /RESULT_PAGE_STALE/);
      assert.throws(() => session.resultPage({ columns: [], rows: [], rowCount: 0 }), /RESULT_PAGE_STALE/);
      session.restoreResult({ columns: [], rows: [], rowCount: 0 });
      const replacement = session.resultPage(session.getLastResult()!);
      await session.closeProject();
      assert.throws(() => session.readResultPage({ resultId: replacement.resultId }), /RESULT_PAGE_STALE/);
    } finally { session.dispose(); }
  });
});

suite("GraphForgeSession command-result ownership", () => {
  const calls: Array<[keyof GraphForgeNative, (session: GraphForgeSession) => Promise<QueryResult>]> = [
    ["listAssertions", session => session.listAssertions()],
    ["listCheckpoints", session => session.listCheckpoints()],
    ["listAlgorithmRuns", session => session.listAlgorithmRuns()],
    ["attachEvidence", session => session.attachEvidence({ assertionUuid: "assertion", sourceUuid: "source", sourceKind: "document", role: "supports" })],
    ["createAssertion", async session => (await session.createAssertion({ claim: "fixture", graphRefs: [{ graphUuid: "node", graphKind: "node", role: "subject", ordinal: 0 }] })).result],
  ];
  for (const [method, run] of calls) {
    test(`${method} rejects an async result from the previous backend`, async () => {
      const session = new GraphForgeSession();
      let release!: (ipc: Buffer) => void;
      const response = new Promise<Buffer>(resolve => { release = resolve; });
      injectForge(session, makeStubForge({ [method]: () => response }));
      try {
        const result = run(session);
        injectForge(session, makeStubForge());
        release(encodeSimpleTable(["value"], [{ value: "original" }]));
        await assert.rejects(result, (error: unknown) => (error as { code?: string }).code === "SESSION_CHANGED");
        assert.throws(() => session.readResultPage({ resultId: "unknown" }), /RESULT_PAGE_STALE/);
      } finally { session.dispose(); }
    });
    test(`${method} binds a successful result before command exposure`, async () => {
      const session = new GraphForgeSession();
      injectForge(session, makeStubForge({ [method]: () => Promise.resolve(encodeSimpleTable(["value"], [{ value: "current" }])) }));
      try {
        const result = await run(session);
        const page = session.resultPage(result);
        assert.deepEqual(session.readResultPage({ resultId: page.resultId }).rows, [{ value: "current" }]);
        injectForge(session, makeStubForge());
        assert.throws(() => session.resultPage(result), /RESULT_PAGE_STALE/);
      } finally { session.dispose(); }
    });
  }

  test("a checkpoint query keeps its opening backend across delayed command input", () => {
    const session = new GraphForgeSession();
    let executions = 0;
    injectForge(session, makeStubForge({ openCheckpoint: () => ({
      checkpointUuid: "checkpoint", generationUuid: "generation",
      execute: () => { executions++; return encodeSimpleTable(["value"], [{ value: "checkpoint" }]); },
      projectCapabilities: () => Buffer.alloc(0), inspectAdjacency: () => ({}),
    }) }));
    try {
      const view = session.openCheckpointView("fixture");
      const result = view.execute("read");
      assert.equal(result.generationUuid, "generation");
      assert.deepEqual(session.resultPage(result).rows, [{ value: "checkpoint" }]);
      injectForge(session, makeStubForge());
      assert.throws(() => view.execute("delayed read"), (error: unknown) => (error as { code?: string }).code === "SESSION_CHANGED");
      assert.equal(executions, 1, "never execute the stale handle against another project session");
    } finally { session.dispose(); }
  });
});

suite("GraphForgeSession result completion boundaries", () => {
  test("validating an older command does not replace the newer public result", async () => {
    const session = new GraphForgeSession();
    injectForge(session, makeStubForge({ execute: () => encodeSimpleTable(["value"], [{ value: "fixture" }]) }));
    try {
      const old = session.resultPage(await session.execute("old"), { verb: "rank", by: "fixture" });
      const current = session.resultPage(await session.execute("current"));
      await Promise.resolve();
      assert.throws(() => session.assertResultPageCurrent(old.resultId), /RESULT_PAGE_STALE/);
      session.assertResultPageCurrent(current.resultId);
      assert.equal(session.readResultPage({ resultId: current.resultId }).resultId, current.resultId);
    } finally { session.dispose(); }
  });

  test("checkpoint diff forwards the native cursor and preserves final-page omission", async () => {
    const session = new GraphForgeSession();
    const seen: unknown[] = [];
    injectForge(session, makeStubForge({ diffCheckpoints: async args => {
      seen.push(args);
      const table = tableFromArrays({ value: Int32Array.from({ length: args.after ? 50 : 100 }, (_, i) => i + (args.after ? 100 : 0)) });
      if (!args.after) table.schema.metadata.set("graphforge.next_page_token", "native opaque cursor");
      return Buffer.from(tableToIPC(table));
    } }));
    try {
      const first = session.resultPage(await session.diffCheckpoints("before", "after", "graph", "records", 100));
      assert.equal(first.rows.length, 100);
      assert.equal(first.nextPageToken, "native opaque cursor");
      const last = session.resultPage(await session.diffCheckpoints("before", "after", "graph", "records", 100, first.nextPageToken));
      assert.equal(last.rows.length, 50);
      assert.equal(last.nextPageToken, undefined);
      assert.deepEqual(seen, [
        { from: "before", to: "after", scope: "graph", detail: "records", limit: 100, after: undefined },
        { from: "before", to: "after", scope: "graph", detail: "records", limit: 100, after: "native opaque cursor" },
      ]);
    } finally { session.dispose(); }
  });

  test("native list continuations retain their filters and forward opaque cursors", async () => {
    const session = new GraphForgeSession();
    const seen: unknown[] = [];
    const list = async (args: unknown) => {
      seen.push(args);
      const table = tableFromArrays({ value: [1] });
      table.schema.metadata.set("graphforge.next_page_token", "next opaque cursor");
      return Buffer.from(tableToIPC(table));
    };
    injectForge(session, makeStubForge({ listAssertions: list, listCheckpoints: list, listAlgorithmRuns: list }));
    try {
      for (const result of [
        await session.listAssertions({ graphUuid: "graph", limit: 2, after: "opaque cursor" }),
        await session.listCheckpoints(2, "opaque cursor"),
        await session.listAlgorithmRuns("pagerank", 2, "opaque cursor"),
      ]) assert.equal(session.resultPage(result).nextPageToken, "next opaque cursor");
      assert.deepEqual(seen, [
        { graphUuid: "graph", limit: 2, after: "opaque cursor" },
        { limit: 2, after: "opaque cursor" },
        { algorithm: "pagerank", limit: 2, after: "opaque cursor" },
      ]);
    } finally { session.dispose(); }
  });

  test("a scheduled saved-result restore observes an atomic backend/project switch", async function () {
    const session = new GraphForgeSession();
    if (!await session.hasUsableRuntime()) {
      session.dispose();
      if (process.env.GRAPHFORGE_REQUIRE_NATIVE) assert.fail("A runtime is required for installation acceptance");
      this.skip();
    }
    injectForge(session, makeStubForge());
    injectCapabilities(session, []);
    const oldProject = session.project;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gf-atomic-open-"));
    const slot = session as unknown as { backend: EngineBackend | undefined };
    let backend = slot.backend;
    let observed: string | undefined;
    Object.defineProperty(session, "backend", { configurable: true, get: () => backend, set: (next: EngineBackend | undefined) => {
      backend = next;
      if (next) queueMicrotask(() => {
        observed = session.project?.rootPath;
        if (session.project === oldProject) session.restoreResult({ columns: ["source"], rows: [{ source: "old" }], rowCount: 1 });
      });
    } });
    try {
      await session.initializeProject(root);
      assert.equal(observed, root);
      assert.equal(session.getLastResult(), undefined, "a previous-project result cannot survive the new session installation");
    } finally { await session.closeProject(); session.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
  });

  for (const action of ["close", "dispose"] as const) {
    test(`${action} cancels an outstanding project attachment`, async function () {
      const session = new GraphForgeSession();
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "gf-cancel-open-"));
      try {
        if (!await session.hasUsableRuntime()) {
          if (process.env.GRAPHFORGE_REQUIRE_NATIVE) assert.fail("A runtime is required for installation acceptance");
          this.skip();
        }
        const pending = session.initializeProject(root);
        let settled = false;
        void pending.then(() => { settled = true; }, () => { settled = true; });
        const rejected = assert.rejects(pending, (error: unknown) => (error as { code?: string }).code === "SESSION_CHANGED");
        if (action === "close") {
          await session.closeProject();
          assert.equal(settled, true, "close must wait for cancelled attachment cleanup");
        }
        else session.dispose();
        await rejected;
        assert.equal(session.project, undefined);
        assert.equal(session.activeRuntime, undefined);
      } finally { await session.closeProject(); session.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
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

  test("canonical edge-only pages retain Inspect data without synthesizing endpoint nodes", async () => {
    const session = new GraphForgeSession();
    try {
      const payload = await session.toGraphPayload({ columns: ["r"], rows: [{ r: { edge_uuid: "edge", src_uuid: "source", dst_uuid: "target", rel_type: "ROUTE", dist: 9 } }], rowCount: 1 });
      assert.deepEqual(payload.nodes, []);
      assert.equal(payload.edges.length, 1);
      assert.equal(payload.edges[0].id, "edge");
      assert.deepEqual(payload.edges[0].properties, { dist: 9 });
    } finally { session.dispose(); }
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
