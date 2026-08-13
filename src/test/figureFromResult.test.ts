import * as assert from "node:assert/strict";
import { buildFigureFromResult } from "../session/figureFromResult";

suite("figureFromResult builders (#62)", () => {
  const columns = ["label", "score", "group"];
  const rows = [
    { label: "a", score: 1, group: "x" },
    { label: "b", score: 3, group: "x" },
    { label: "c", score: 2, group: "y" },
  ];

  test("bar is deterministic for the same inputs", () => {
    const input = {
      columns,
      rows,
      chartType: "bar" as const,
      bindings: { x: "label", y: "score" },
    };
    const a = buildFigureFromResult(input);
    const b = buildFigureFromResult(input);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (a.ok && b.ok) {
      assert.deepEqual(a.figure, b.figure);
      assert.equal(a.figure.data[0]?.type, "bar");
    }
  });

  test("scatter and line set modes; histogram uses x only", () => {
    const scatter = buildFigureFromResult({
      columns,
      rows,
      chartType: "scatter",
      bindings: { x: "label", y: "score" },
    });
    const line = buildFigureFromResult({
      columns,
      rows,
      chartType: "line",
      bindings: { x: "label", y: "score" },
    });
    const hist = buildFigureFromResult({
      columns,
      rows,
      chartType: "histogram",
      bindings: { x: "score" },
    });
    assert.equal(scatter.ok, true);
    assert.equal(line.ok, true);
    assert.equal(hist.ok, true);
    if (scatter.ok) {
      assert.equal(scatter.figure.data[0]?.mode, "markers");
    }
    if (line.ok) {
      assert.equal(line.figure.data[0]?.mode, "lines+markers");
    }
    if (hist.ok) {
      assert.equal(hist.figure.data[0]?.type, "histogram");
      assert.deepEqual(hist.figure.data[0]?.x, [1, 3, 2]);
    }
  });

  test("color splits series; missing columns fail closed", () => {
    const colored = buildFigureFromResult({
      columns,
      rows,
      chartType: "bar",
      bindings: { x: "label", y: "score", color: "group" },
    });
    assert.equal(colored.ok, true);
    if (colored.ok) {
      assert.equal(colored.figure.data.length, 2);
    }
    const missing = buildFigureFromResult({
      columns,
      rows,
      chartType: "bar",
      bindings: { x: "label", y: "missing" },
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.code, "FIGURE_COLUMN");
    }
  });
});
