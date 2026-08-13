import * as assert from "node:assert/strict";
import {
  computeNextAction,
  formatSummaryLines,
} from "../session/environmentReport";

suite("computeNextAction", () => {
  test("points to both Setup commands when neither runtime is usable", () => {
    const action = computeNextAction(false, false, false, "none");
    assert.match(action, /Setup Native Binding/);
    assert.match(action, /Setup Python Binding/);
  });

  test("points to Python selection when only Python is detected", () => {
    const action = computeNextAction(false, true, false, "none");
    assert.match(action, /Python is available/);
  });

  test("points to Initialize/Open when a runtime is active but no project", () => {
    const action = computeNextAction(true, false, false, "node");
    assert.match(action, /Initialize Project Here/);
    assert.match(action, /Open Project/);
  });

  test("reports ready when a runtime and project are both available", () => {
    assert.match(computeNextAction(true, true, true, "node"), /Ready/);
    assert.match(computeNextAction(true, false, true, "node"), /Run Query/);
    assert.match(computeNextAction(false, true, true, "python"), /Run Query/);
  });
});

suite("formatSummaryLines", () => {
  test("produces exactly 3 lines: runtime, project, next", () => {
    const lines = formatSummaryLines({
      runtime: { preference: "auto", active: "node", projectKind: "ambiguous" },
      nodeBinding: { available: true },
      python: { available: false, error: "no interpreter" },
      project: { open: true, path: "/tmp/proj", name: "proj" },
      nextAction: "Ready.",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^Runtime: node \(pref: auto\) — Node: ok, Python: missing$/);
    assert.match(lines[1], /^Project: proj \(\/tmp\/proj\)$/);
    assert.equal(lines[2], "Next: Ready.");
  });

  test("surfaces Python availability and version when active", () => {
    const lines = formatSummaryLines({
      runtime: { preference: "python", active: "python", projectKind: "python" },
      nodeBinding: { available: false, error: "no candidates" },
      python: { available: true, interpreter: "/usr/bin/python3", graphforgeVersion: "0.5.0-dev" },
      project: { open: false },
      nextAction: "Setup.",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    assert.match(lines[0], /Node: missing/);
    assert.match(lines[0], /Python: ok \(0\.5\.0-dev\)/);
    assert.equal(lines[1], "Project: none open");
  });

  test("shows active runtime as none when neither runtime is usable", () => {
    const lines = formatSummaryLines({
      runtime: { preference: "auto", active: "none", projectKind: "ambiguous" },
      nodeBinding: { available: false, error: "no candidates" },
      python: { available: false, error: "no interpreter" },
      project: { open: false },
      nextAction: "Setup both.",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    assert.match(lines[0], /^Runtime: none \(pref: auto\)/);
  });
});
