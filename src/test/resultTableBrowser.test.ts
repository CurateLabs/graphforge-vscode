import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vm from "node:vm";
import type { HostToWebview, ResultMessageContext, ResultPageDirection, WebviewToHost } from "../webview/protocol";

/** Message/DOM contract fixture for the actual shipped Results bundle; no browser or renderer. */
class ElementFixture {
  readonly tagName: string;
  children: ElementFixture[] = [];
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  listeners: Record<string, (event: unknown) => void> = {};
  hidden = false;
  disabled = false;
  textContent = "";
  readonly classList = (() => {
    const names = new Set<string>();
    return { add: (...items: string[]) => items.forEach(item => names.add(item)),
      remove: (...items: string[]) => items.forEach(item => names.delete(item)),
      toggle: (name: string, force?: boolean) => { if (force ?? !names.has(name)) names.add(name); else names.delete(name); } };
  })();
  constructor(tag = "div") { this.tagName = tag.toUpperCase(); }
  append(...items: ElementFixture[]) {
    for (const item of items) this.children.push(...(item.tagName === "FRAGMENT" ? item.children : [item]));
  }
  replaceChildren(...items: ElementFixture[]) { this.children = []; this.append(...items); }
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  addEventListener(name: string, callback: (event: unknown) => void) { this.listeners[name] = callback; }
  querySelectorAll(selector: string): ElementFixture[] {
    const all = this.children.flatMap(child => [child, ...child.querySelectorAll("*")]);
    if (selector === "*") return all;
    return all.filter(child => selector.startsWith("tr") ? child.tagName === "TR" : selector === "button" && child.tagName === "BUTTON");
  }
  querySelector(selector: string) {
    const index = selector.match(/data-row-index="(\d+)"/);
    return this.querySelectorAll(selector).find(child => !index || child.dataset.rowIndex === index[1]) ?? null;
  }
  focus() {} scrollIntoView() {} closest() { return null; }
  click() { this.listeners.click?.({ stopPropagation() {}, shiftKey: false, target: this }); }
}

function browserFixture() {
  const elements = new Map<string, ElementFixture>();
  const sent: WebviewToHost[] = [];
  let receive: (event: { data: HostToWebview }) => void = () => {};
  const element = (id: string) => {
    let item = elements.get(id);
    if (!item) elements.set(id, item = new ElementFixture());
    return item;
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "webview-ui", "results.js"), "utf8"), {
    document: { getElementById: element, createElement: (tag: string) => new ElementFixture(tag),
      createDocumentFragment: () => new ElementFixture("fragment") },
    window: { addEventListener: (_name: string, callback: typeof receive) => { receive = callback; } },
    acquireVsCodeApi: () => ({ postMessage: (message: WebviewToHost) => sent.push(message) }),
    matchMedia: () => ({ matches: true }),
  });
  return { element, sent, send: (message: HostToWebview) => receive({ data: message }) };
}

const context = (revision = 1, pageVersion = 1, resultId = "source-a"): ResultMessageContext => ({ revision, pageVersion, resultId });
function page(offset: number, count: number, nextOffset?: number, ctx = context(), direction?: ResultPageDirection): Extract<HostToWebview, { type: "graphforge/results" }> {
  return { type: "graphforge/results", ...ctx, title: "fixture", direction,
    result: { resultId: ctx.resultId, offset, rows: Array.from({ length: count }, (_, index) => ({ id: offset + index })),
      columns: ["id"], rowCount: 1200, nextOffset } };
}

suite("Results browser paging message contract", () => {
  test("uses actual shortened-page offsets in both directions and rejects older page replies", () => {
    const f = browserFixture();
    f.send(page(0, 3, 3));
    f.element("load-more").click();
    assert.equal((f.sent.at(-1) as { offset: number }).offset, 3);
    assert.equal(f.element("load-more").disabled, true);
    f.send({ type: "graphforge/resultsLoading", ...context(1, 2), title: "fixture", rowCount: 1200, persisted: false, reset: false });
    f.send(page(500, 2, 502, context(), "next"));
    assert.equal(f.element("table-body").children[0].dataset.rowIndex, "0");
    f.send(page(3, 2, 5, context(1, 2), "next"));
    assert.equal(f.element("table-body").children[0].dataset.rowIndex, "3");
    assert.equal(f.element("results-table").attrs["aria-rowcount"], "1201");
    f.element("load-more").click();
    assert.equal((f.sent.at(-1) as { offset: number }).offset, 5);
    f.send(page(5, 4, 9, context(1, 3), "next"));
    f.element("previous-rows").click();
    assert.equal((f.sent.at(-1) as { offset: number }).offset, 3);
    f.send(page(3, 2, 5, context(1, 4), "previous"));
    f.element("previous-rows").click();
    assert.equal((f.sent.at(-1) as { offset: number }).offset, 0);
    f.send(page(0, 3, 3, context(1, 5), "previous"));
    assert.equal(f.element("previous-rows").disabled, true);
  });

  test("reloaded later pages offer First rows and resume exact byte-shortened forward boundaries", () => {
    const f = browserFixture();
    // The host republishes its retained page after ready, without browser-only history.
    f.send(page(811, 2, undefined, context(1, 6)));
    assert.equal(f.element("previous-rows").hidden, false);
    assert.equal(f.element("previous-rows").disabled, false);
    assert.equal(f.element("previous-rows").textContent, "First rows");
    f.element("previous-rows").click();
    assert.equal((f.sent.at(-1) as { offset: number }).offset, 0);
    assert.equal(f.element("previous-rows").disabled, true);
    f.send(page(0, 3, 3, context(1, 7), "previous"));
    f.element("load-more").click();
    assert.equal((f.sent.at(-1) as { offset: number }).offset, 3);
    f.send(page(3, 2, 5, context(1, 8), "next"));
    assert.equal(f.element("previous-rows").textContent, "Previous rows");
    f.element("previous-rows").click();
    assert.equal((f.sent.at(-1) as { offset: number }).offset, 0);
  });

  test("clears replaced sources, renders global selected rows and clears empty membership", () => {
    const f = browserFixture();
    f.send({ ...page(811, 2, 813), selectedRows: [811], selectedCount: 2, focusRow: 811 });
    assert.equal(f.element("table-body").children[0].attrs["aria-selected"], "true");
    assert.match(f.element("link-status").textContent, /2 row\(s\); 1 on this page/);
    f.send({ type: "graphforge/highlightResultRows", ...context(), rowIndices: [], selectedCount: 0 });
    assert.equal(f.element("table-body").children[0].attrs["aria-selected"], "false");
    f.send({ type: "graphforge/resultsLoading", ...context(2, 1, "source-b"), title: "new", rowCount: 1200, persisted: true, reset: true });
    assert.equal(f.element("table-body").children.length, 0);
    assert.equal(f.element("results-table").hidden, true);
    f.send(page(0, 2, 2, context(1, 7)));
    assert.equal(f.element("table-body").children.length, 0);
    f.send({ ...page(0, 2, 2, context(2, 1, "source-b")), inspectNotice: "Open the saved JSON document to inspect entities." });
    assert.match(f.element("summary").textContent, /saved JSON/);
    f.send({ type: "graphforge/resultsCleared", ...context(1, 8), message: "stale project change" });
    assert.equal(f.element("table-body").children.length, 2);
    f.send({ type: "graphforge/resultsCleared", ...context(3, 2, "source-b"), message: "Project changed. Run a query." });
    assert.equal(f.element("table-body").children.length, 0);
    assert.equal(f.element("results-table").hidden, true);
    assert.equal(f.element("document-actions").hidden, true);
  });

  test("preserves the current page after errors and binds document actions to the new context", () => {
    const f = browserFixture();
    f.send(page(0, 2, 2));
    f.send({ type: "graphforge/resultsLoading", ...context(1, 2), title: "fixture", rowCount: 1200, persisted: true, reset: false });
    f.send({ type: "graphforge/resultsError", ...context(1, 2), message: "Open the saved document." });
    assert.equal(f.element("table-body").children.length, 2);
    assert.equal(f.element("load-more").disabled, false);
    assert.match(f.element("link-status").textContent, /saved document/);
    f.element("open-json").click();
    assert.deepEqual(JSON.parse(JSON.stringify(f.sent.at(-1))), { type: "graphforge/openResultDocument", ...context(1, 2), kind: "json" });
    f.send({ type: "graphforge/resultSelection", ...context(), linked: true, message: "stale selection" });
    assert.match(f.element("link-status").textContent, /saved document/);
  });
});
