import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { GraphForgeSession } from "../session/graphForgeSession";
import type { GraphPayload, QueryResult } from "../session/types";
import { lazyResultRows } from "../session/resultRows";
import type { HostToWebview, WebviewToHost } from "../webview/protocol";
import { ResultTableViewProvider } from "../views/resultTableView";
import { EntityInspectPanel } from "../webview/entityInspectPanel";
import { XygVisualizationPanel } from "../webview/xygPanel";

const emptyGraph: GraphPayload = { nodes: [], edges: [], legend: { statuses: [], types: [] }, styleMode: "class-only" };
const source = (count: number): QueryResult => ({
  columns: ["id"], rows: Array.from({ length: count }, (_, id) => ({ id: String(id) })), rowCount: count,
  ipc: new Uint8Array([1, 2, 3]),
});
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
type PageMessage = Extract<HostToWebview, { type: "graphforge/results" }>;

function fixture(project = "/tmp/results-page-test") {
  const messages: HostToWebview[] = [];
  const projections: QueryResult[] = [];
  let receive: (message: WebviewToHost) => void = () => {};
  const projectEvents = new vscode.EventEmitter<void>();
  const session = {
    onDidChange: projectEvents.event,
    project: { rootPath: project },
    toGraphPayload: async (result: QueryResult) => { projections.push(result); return emptyGraph; },
  };
  const provider = new ResultTableViewProvider(vscode.Uri.file(project), session as unknown as GraphForgeSession);
  provider.reveal = async () => {};
  const webview = {
    options: {}, html: "", cspSource: "https://results.invalid",
    asWebviewUri: (uri: vscode.Uri) => uri,
    postMessage: (message: HostToWebview) => { messages.push(message); return Promise.resolve(true); },
    onDidReceiveMessage: (callback: typeof receive) => { receive = callback; return new vscode.Disposable(() => {}); },
  };
  provider.resolveWebviewView({ webview } as unknown as vscode.WebviewView,
    {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
  return { provider, session, projections, messages, projectChanged: () => projectEvents.fire(),
    receive: (message: WebviewToHost) => receive(message),
    page: () => messages.filter((message): message is PageMessage => message.type === "graphforge/results").at(-1)!,
  };
}

function context(page: PageMessage) {
  return { resultId: page.resultId, revision: page.revision, pageVersion: page.pageVersion };
}

function pickRows(result: QueryResult, rowIndices: number[], projectRoot = "/tmp/results-page-test") {
  // Exercise the real source-bound relay, without a visualization or native render.
  (XygVisualizationPanel as unknown as { rowSelection: vscode.EventEmitter<{ source: QueryResult; projectRoot: string; rowIndices: number[] }> })
    .rowSelection.fire({ source: result, projectRoot, rowIndices });
}

function pickEntity(result: QueryResult, id: string, rowIndices?: number[]) {
  (XygVisualizationPanel as unknown as { selection: vscode.EventEmitter<{
    kind: "node"; item: { id: string; labels: string[]; properties: Record<string, unknown> };
    source: QueryResult; projectRoot: string; rowIndices?: number[];
  }> }).selection.fire({ kind: "node", item: { id, labels: [], properties: {} }, source: result,
    projectRoot: "/tmp/results-page-test", ...(rowIndices !== undefined ? { rowIndices } : {}) });
}

suite("Results bounded host paging", () => {
  test("projects and posts only the requested page while retaining complete source membership", async () => {
    const f = fixture();
    try {
      const result = source(1200);
      await f.provider.show(result, "paged");
      const first = f.page();
      assert.equal(first.result.rows.length, 500);
      assert.equal(first.result.rowCount, 1200);
      assert.equal("ipc" in first.result, false);
      assert.equal(f.projections[0].rows.length, 500);
      assert.equal(f.projections[0].rowCount, 500);
      assert.equal("ipc" in f.projections[0], false);
      f.receive({ type: "graphforge/requestResultPage", ...context(first), offset: first.result.nextOffset!, direction: "next" });
      await settle();
      assert.equal(f.page().result.offset, 500);
      assert.equal(f.page().result.rows[0].id, "500");
      pickRows(result, [811, 1199]);
      await settle();
      const selection = f.messages.at(-1)!;
      assert.equal(selection.type, "graphforge/highlightResultRows");
      if (selection.type === "graphforge/highlightResultRows") {
        assert.deepEqual(selection.rowIndices, [811]);
        assert.equal(selection.selectedCount, 2);
      }
      pickRows(result, []);
      await settle();
      const cleared = f.messages.at(-1)!;
      assert.equal(cleared.type, "graphforge/highlightResultRows");
      if (cleared.type === "graphforge/highlightResultRows") assert.deepEqual(cleared.rowIndices, []);
      pickRows(result, [1100]);
      await settle();
      assert.equal(f.page().result.offset, 1100);
      assert.deepEqual(f.page().selectedRows, [1100]);
      assert.equal(f.page().focusRow, 1100);
      const before = f.messages.length;
      pickRows({ ...result }, [1]);
      pickRows(result, [1], "/tmp/different-project");
      await settle();
      assert.equal(f.messages.length, before, "equal-looking sources and other projects must not link");
    } finally { f.provider.dispose(); }
  });

  test("plain graph picks find off-page source rows without materializing the full result", async () => {
    const f = fixture();
    try {
      let reads = 0;
      const result: QueryResult = { columns: ["id"], rows: lazyResultRows(1200, index => { reads++; return { id: String(index) }; }), rowCount: 1200 };
      await f.provider.show(result, "plain graph");
      reads = 0;
      pickEntity(result, "811");
      assert.ok(reads <= 500, "selection scanning yields after a bounded batch");
      await settle(); await settle(); await settle();
      assert.equal(f.page().result.offset, 811);
      assert.deepEqual(f.page().selectedRows, [811]);
      assert.ok(f.projections.every(page => page.rows.length <= 500 && page.rowCount <= 500));
      assert.ok(f.messages.filter(message => message.type === "graphforge/results").every(message => message.result.rows.length <= 500));
    } finally { f.provider.dispose(); }
  });

  test("native empty membership remains authoritative and missing plain identities clear selection", async () => {
    const f = fixture();
    try {
      let reads = 0;
      const result: QueryResult = { columns: ["id"], rows: lazyResultRows(1200, index => { reads++; return { id: String(index) }; }), rowCount: 1200 };
      await f.provider.show(result, "plain graph");
      pickRows(result, [10]);
      reads = 0;
      pickEntity(result, "811", []);
      assert.equal(reads, 0, "explicit native emptiness must not fall back to matching aliases");
      const empty = f.messages.at(-1)!;
      assert.equal(empty.type, "graphforge/highlightResultRows");
      if (empty.type === "graphforge/highlightResultRows") {
        assert.deepEqual(empty.rowIndices, []);
        assert.equal(empty.selectedCount, 0);
      }
      pickRows(result, [10]);
      pickEntity(result, "missing");
      await settle(); await settle(); await settle();
      const message = f.messages.at(-1)!;
      assert.equal(message.type, "graphforge/highlightResultRows");
      if (message.type === "graphforge/highlightResultRows") assert.deepEqual(message.rowIndices, []);
    } finally { f.provider.dispose(); }
  });

  for (const replacement of ["on-page", "clear", "project", "result"] as const) {
    test(`plain graph scanning stops when superseded by ${replacement}`, async () => {
      const f = fixture();
      try {
        let reads = 0;
        const result: QueryResult = { columns: ["id"], rows: lazyResultRows(1200, index => { reads++; return { id: String(index) }; }), rowCount: 1200 };
        await f.provider.show(result, "plain graph");
        reads = 0;
        pickEntity(result, "811");
        if (replacement === "project") { f.session.project = { rootPath: "/tmp/results-page-test" }; f.projectChanged(); }
        else if (replacement === "result") await f.provider.show(source(20), "replacement");
        else pickRows(result, replacement === "on-page" ? [10] : []);
        const before = f.messages.length;
        await settle(); await settle(); await settle();
        assert.ok(reads <= 500, "superseded scan must not decode another batch");
        assert.equal(f.messages.length, before);
        assert.equal(f.page().result.offset, 0);
      } finally { f.provider.dispose(); }
    });
  }

  test("later pages retain canonical edge Inspect under arbitrary Cypher aliases without earlier nodes", async () => {
    const f = fixture();
    const show = EntityInspectPanel.show;
    try {
      const edge = { edge_uuid: "route-811", src_uuid: "ATL", dst_uuid: "AUS", rel_type: "ROUTE", distance: 813 };
      const result: QueryResult = { columns: ["r"], rows: [
        ...Array.from({ length: 500 }, (_, index) => ({ r: { node_uuid: `node-${index}`, labels: ["Airport"] } })),
        { r: edge },
      ], rowCount: 501 };
      const projectionSession = Object.create(GraphForgeSession.prototype) as GraphForgeSession;
      f.session.toGraphPayload = async (page: QueryResult) => {
        f.projections.push(page);
        return projectionSession.toGraphPayload(page);
      };
      let inspected: unknown;
      EntityInspectPanel.show = (_extension, selection) => { inspected = selection; return {} as EntityInspectPanel; };
      await f.provider.show(result, "canonical edges");
      f.receive({ type: "graphforge/requestResultPage", ...context(f.page()), offset: 500, direction: "next" });
      await settle();
      const page = f.page();
      assert.equal(page.result.rows.length, 1);
      assert.deepEqual(page.entityLinks?.["500"], [{ kind: "edge", id: "route-811", label: "R" }]);
      f.receive({ type: "graphforge/openResultEntity", ...context(page), rowIndex: 500, kind: "edge", id: "route-811" });
      assert.deepEqual(inspected, { kind: "edge", item: { id: "route-811", type: "ROUTE", source: "ATL", target: "AUS", properties: { distance: 813 } } });
      assert.equal(f.projections.at(-1)?.rows.length, 1);
    } finally { EntityInspectPanel.show = show; f.provider.dispose(); }
  });

  test("discards replaced results and superseded asynchronous page projections", async () => {
    const f = fixture();
    try {
      const pending: Array<() => void> = [];
      f.session.toGraphPayload = (result: QueryResult) => {
        f.projections.push(result);
        return new Promise(resolve => pending.push(() => resolve(emptyGraph)));
      };
      const old = f.provider.show(source(1200), "old");
      const current = f.provider.show(source(600), "current");
      pending[1]();
      await current;
      const first = f.page();
      pending[0]();
      await old;
      assert.equal(f.page(), first);
      assert.ok(f.messages.filter(message => message.type === "graphforge/results").every(message => message.title === "current"));
      f.receive({ type: "graphforge/requestResultPage", ...context(first), offset: 500, direction: "next" });
      f.receive({ type: "graphforge/selectResult", ...context(first), rowIndex: 0 });
      assert.equal(f.messages.at(-1)?.type, "graphforge/resultsLoading", "in-flight page blocks old actions");
      f.session.project = { rootPath: "/tmp/results-page-test" };
      f.projectChanged();
      assert.equal(f.messages.at(-1)?.type, "graphforge/resultsCleared");
      pending[2]();
      await settle();
      assert.equal(f.messages.at(-1)?.type, "graphforge/resultsCleared");
      assert.equal(f.page(), first, "changed project cannot receive a pending page");
    } finally { f.provider.dispose(); }
  });

  test("a newer native selection supersedes an in-flight page projection", async () => {
    const f = fixture();
    try {
      const result = source(1200);
      await f.provider.show(result, "paged");
      const first = f.page();
      const pending: Array<() => void> = [];
      f.session.toGraphPayload = () => new Promise(resolve => pending.push(() => resolve(emptyGraph)));
      f.receive({ type: "graphforge/requestResultPage", ...context(first), offset: 500, direction: "next" });
      pickRows(result, [811]);
      assert.equal(pending.length, 2);
      pending[0]();
      await settle();
      assert.equal(f.page(), first);
      pending[1]();
      await settle();
      assert.equal(f.page().result.offset, 811);
      assert.deepEqual(f.page().selectedRows, [811]);
    } finally { f.provider.dispose(); }
  });

  for (const latest of [[10], []]) {
    test(`a newer ${latest.length ? "on-page pick" : "clear"} cancels pending off-page work`, async () => {
      const f = fixture();
      try {
        const result = source(1200);
        await f.provider.show(result, "paged");
        const first = f.page();
        const pending: Array<() => void> = [];
        f.session.toGraphPayload = () => new Promise(resolve => pending.push(() => resolve(emptyGraph)));
        pickRows(result, [811]);
        assert.equal(pending.length, 1);
        pickRows(result, latest);
        pending[0]();
        await settle();
        assert.equal(f.page().result.offset, 0, "an older pick must not navigate away from the latest selection");
        assert.deepEqual(f.page().selectedRows, latest);
        assert.equal(f.page().selectedCount, latest.length);
        assert.ok(f.page().pageVersion > first.pageVersion, "browser must leave the cancelled loading context");
      } finally { f.provider.dispose(); }
    });
  }

  for (const action of ["row", "inspect"] as const) {
    test(`retains a clicked ${action} selection across Next and Previous`, async () => {
      const f = fixture();
      const show = EntityInspectPanel.show;
      let inspections = 0;
      EntityInspectPanel.show = () => { inspections++; return {} as EntityInspectPanel; };
      try {
        f.session.toGraphPayload = async result => ({ ...emptyGraph, nodes: result.rows.map(row => ({ id: String(row.id), labels: [], properties: {} })) });
        const result = source(1200);
        await f.provider.show(result, "paged");
        pickRows(result, [3]);
        await settle();
        const first = f.page();
        if (action === "row") f.receive({ type: "graphforge/selectResult", ...context(first), rowIndex: 10 });
        else f.receive({ type: "graphforge/openResultEntity", ...context(first), rowIndex: 10, kind: "node", id: "10" });
        assert.equal(inspections, action === "inspect" ? 1 : 0);
        f.receive({ type: "graphforge/requestResultPage", ...context(first), offset: 500, direction: "next" });
        await settle();
        assert.equal(f.page().result.offset, 500);
        assert.equal(f.page().selectedCount, 1);
        f.receive({ type: "graphforge/requestResultPage", ...context(f.page()), offset: 0, direction: "previous" });
        await settle();
        assert.deepEqual(f.page().selectedRows, [10], "the clicked row replaces any earlier graph selection");
      } finally { EntityInspectPanel.show = show; f.provider.dispose(); }
    });
  }

  test("omits excessive optional Inspect links without truncating the result page", async () => {
    const f = fixture();
    try {
      f.session.toGraphPayload = async () => ({ ...emptyGraph, nodes: Array.from({ length: 200 }, (_, index) =>
        ({ id: `node-${index}`, labels: [], properties: { code: "shared" } })) });
      const result: QueryResult = { columns: ["id"], rows: [{ id: "shared" }, { id: "shared" }], rowCount: 2 };
      await f.provider.show(result, "wide aliases");
      const posted = f.page();
      assert.deepEqual(posted.result.rows, result.rows);
      assert.equal(posted.entityLinks, undefined);
      assert.match(posted.inspectNotice!, /saved JSON or Markdown/);
      assert.ok(Buffer.byteLength(JSON.stringify(posted)) < 8 * 1024 * 1024);
    } finally { f.provider.dispose(); }
  });

  test("old result/page actions and out-of-page entity inspection are ignored", async () => {
    const f = fixture();
    try {
      await f.provider.show(source(1200), "first");
      const old = f.page();
      await f.provider.show(source(1200), "second");
      const current = f.page();
      let before = f.messages.length;
      f.receive({ type: "graphforge/selectResult", ...context(old), rowIndex: 0 });
      f.receive({ type: "graphforge/requestResultPage", ...context(current), pageVersion: current.pageVersion - 1, offset: 500, direction: "next" });
      f.receive({ type: "graphforge/selectResult", ...context(current), rowIndex: 811 });
      f.receive({ type: "graphforge/openResultEntity", ...context(current), rowIndex: 811, kind: "node", id: "811" });
      assert.equal(f.messages.length, before);
      f.receive({ type: "graphforge/selectResult", ...context(current), rowIndex: 0 });
      assert.equal(f.messages.length, before + 1);
      assert.equal(f.messages.at(-1)?.type, "graphforge/resultSelection");
      f.receive({ type: "graphforge/requestResultPage", ...context(current), offset: -1, direction: "next" });
      await settle();
      assert.equal(f.messages.at(-1)?.type, "graphforge/resultsError");
      before = f.messages.length;
      f.receive({ type: "graphforge/ready" });
      assert.ok(f.messages.slice(before).some(message => message.type === "graphforge/results" && message.result.offset === 0),
        "failed navigation preserves the previous bounded page");
    } finally { f.provider.dispose(); }
  });
});
