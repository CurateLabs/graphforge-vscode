import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { XygVisualizationPanel } from "../webview/xygPanel";

suite("XYG acknowledged HTML export", () => {
  let root: string;
  let panel: any;
  setup(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "gf-html-export-"));
    panel = Object.assign(Object.create(XygVisualizationPanel.prototype), {
      isReady: true, disposed: false, needsRender: false, acceptedFrame: 4,
      lifecycle: { renderGeneration: 2 }, projectRoot: root,
      spec: { kind: "temporal", name: "Test timeline" },
      payload: { spec: { title: "Painted timeline" }, buffer: Uint8Array.of(1, 2).buffer },
      xy: { toHtml: () => "<!doctype html>" }, post() {},
    });
  });
  teardown(() => fs.rmSync(root, { recursive: true, force: true }));

  test("exports the acknowledged payload without rebuilding the figure", async () => {
    panel.xy.toHtml = (payload: any) => {
      assert.equal(payload.spec, panel.payload.spec);
      assert.equal(payload.buffers, panel.payload.buffer);
      return "<!doctype html>";
    };
    const { htmlPath } = await panel.exportHtml();
    assert.equal(fs.readFileSync(htmlPath, "utf8"), "<!doctype html>");
  });
  test("preserves existing exports and separates concurrent sanitized-name collisions", async () => {
    const directory = path.join(root, "visualizations/exports");
    fs.mkdirSync(directory, { recursive: true });
    const existing = path.join(directory, "A-B.html");
    fs.writeFileSync(existing, "previous export");
    const exports = await Promise.all(Array.from({ length: 6 }, async (_, index) => {
      const current = Object.assign(Object.create(XygVisualizationPanel.prototype), panel, {
        spec: { kind: "temporal", name: index % 2 ? "A B" : "A?B" },
        xy: { toHtml: () => `<!doctype html><title>Export ${index}</title>` },
      });
      const result = await current.exportHtml();
      return { ...result, index };
    }));
    assert.equal(fs.readFileSync(existing, "utf8"), "previous export");
    assert.equal(new Set(exports.map(result => result.htmlPath)).size, 6);
    for (const { htmlPath, index } of exports)
      assert.equal(fs.readFileSync(htmlPath, "utf8"), `<!doctype html><title>Export ${index}</title>`);
  });
  test("rejects loading, disposed, dirty and unacknowledged views before writing", async () => {
    for (const [field, value] of [["isReady", false], ["disposed", true], ["needsRender", true], ["acceptedFrame", 0]] as const) {
      const previous = panel[field];
      panel[field] = value;
      await assert.rejects(panel.exportHtml(), /XYG_EXPORT_NOT_READY/);
      panel[field] = previous;
    }
    assert.deepEqual(fs.readdirSync(root), []);
  });
  test("rejects a superseded or disposed export while the directory is prepared", async () => {
    for (const change of [() => panel.lifecycle.renderGeneration++, () => { panel.disposed = true; }]) {
      const pending = panel.exportHtml();
      change();
      await assert.rejects(pending, /XYG_EXPORT_NOT_READY/);
    }
    assert.deepEqual(fs.readdirSync(path.join(root, "visualizations/exports")), []);
  });
  test("rejects painter-only maps and explains a missing packaged client", async () => {
    panel.payload = { buffer: panel.payload.buffer };
    await assert.rejects(panel.exportHtml(), /XYG_HTML_EXPORT_UNAVAILABLE/);
    panel.payload.spec = {};
    panel.xy.toHtml = () => { throw new Error("Host-neutral paint client missing"); };
    await assert.rejects(panel.exportHtml(), /XYG_HTML_CLIENT_MISSING: Reinstall/);
    assert.deepEqual(fs.readdirSync(root), []);
  });
});
