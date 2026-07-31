import * as assert from "node:assert/strict";
import {
  computeNextAction,
  formatSummaryLines,
} from "../session/environmentReport";

suite("computeNextAction", () => {
  test("points to Setup Native Binding when binding is missing", () => {
    assert.match(computeNextAction(false, false), /Setup Native Binding/);
    assert.match(computeNextAction(false, true), /Setup Native Binding/);
  });

  test("points to Initialize/Open when binding ok but no project", () => {
    const action = computeNextAction(true, false);
    assert.match(action, /Initialize Project Here/);
    assert.match(action, /Open Project/);
  });

  test("reports ready when binding and project are both available", () => {
    assert.match(computeNextAction(true, true), /Ready/);
    assert.match(computeNextAction(true, true), /Run Query/);
  });
});

suite("formatSummaryLines", () => {
  test("produces exactly 3 lines: binding, project, next", () => {
    const lines = formatSummaryLines({
      binding: { available: true },
      project: { open: true, path: "/tmp/proj", name: "proj" },
      nextAction: "Ready.",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^Binding: ok$/);
    assert.match(lines[1], /^Project: proj \(\/tmp\/proj\)$/);
    assert.equal(lines[2], "Next: Ready.");
  });

  test("surfaces the binding error when missing", () => {
    const lines = formatSummaryLines({
      binding: { available: false, error: "no candidates" },
      project: { open: false },
      nextAction: "Setup.",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    assert.match(lines[0], /missing — no candidates/);
    assert.equal(lines[1], "Project: none open");
  });
});
