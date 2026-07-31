import * as assert from "node:assert/strict";
import {
  engineErrorCode,
  errorMessage,
  oneLineSummary,
  presentError,
} from "../commands/errorPresentation";
import { NodeOnlyFeatureError, UnsupportedByBindingError } from "../session/errors";

/**
 * Representative raw failure fixtures (#27/#28): what the loaders actually
 * produce on a cold machine with neither runtime configured. Presentation
 * must never let this text reach a toast or tooltip.
 */
const RAW_NODE_REQUIRE_ERROR =
  "GraphForge native binding unavailable. Tried: @graphforge/node: Cannot find module '@graphforge/node'\n" +
  "Require stack:\n" +
  "- /home/user/.vscode/extensions/curatelabs.graphforge-0.1.0/dist/extension.js";

const RAW_PYTHON_PROBE_ERROR =
  "graphforge not importable in any detected interpreter. Tried: " +
  "/usr/bin/python3 (path): ModuleNotFoundError: No module named 'graphforge' | " +
  "/workspace/.venv/bin/python (venv): ModuleNotFoundError: No module named 'graphforge'";

suite("presentError — severity routing (#38)", () => {
  test("NodeOnlyFeatureError is a warning, with its actionable hint intact", () => {
    const presented = presentError(new NodeOnlyFeatureError("createCheckpoint"));
    assert.equal(presented.severity, "warning");
    assert.equal(presented.setup, false);
    assert.match(presented.message, /requires the Node runtime/);
    assert.match(presented.message, /graphforge\.runtime/);
  });

  test("UnsupportedByBindingError is a warning", () => {
    const presented = presentError(new UnsupportedByBindingError("diffCheckpoints"));
    assert.equal(presented.severity, "warning");
    assert.match(presented.message, /does not expose/);
  });

  test("a generic engine error is error severity with a one-line message", () => {
    const presented = presentError(new Error("parse error at line 1: unexpected token"));
    assert.equal(presented.severity, "error");
    assert.equal(presented.setup, false);
    assert.equal(presented.message, "parse error at line 1: unexpected token");
  });
});

suite("presentError — setup failures collapse to curated copy (#28)", () => {
  test("raw require() noise becomes a short setup message with recovery routing", () => {
    const presented = presentError(new Error(RAW_NODE_REQUIRE_ERROR));
    assert.equal(presented.severity, "error");
    assert.equal(presented.setup, true);
    assert.equal(presented.message, "No usable GraphForge runtime.");
  });

  test("describeRuntimeUnavailable-shaped errors are setup failures", () => {
    const presented = presentError(
      new Error('No usable GraphForge runtime (preference "auto") — full diagnostics: "GraphForge: Check Environment".'),
    );
    assert.equal(presented.setup, true);
    assert.equal(presented.message, "No usable GraphForge runtime.");
  });

  test("raw Require stack text never appears in toast copy, but survives in detail", () => {
    const presented = presentError(new Error(RAW_NODE_REQUIRE_ERROR));
    assert.ok(!presented.message.includes("Require stack:"), "toast copy leaked Require stack");
    assert.ok(!presented.message.includes("Cannot find module"), "toast copy leaked require noise");
    assert.equal(presented.detail, RAW_NODE_REQUIRE_ERROR);
  });

  test("joined multi-interpreter Python probe blobs collapse to the setup message", () => {
    const presented = presentError(new Error(RAW_PYTHON_PROBE_ERROR));
    assert.equal(presented.setup, true);
    assert.equal(presented.message, "No usable GraphForge runtime.");
    assert.ok(!presented.message.includes("ModuleNotFoundError"));
    assert.equal(presented.detail, RAW_PYTHON_PROBE_ERROR);
  });
});

suite("presentError — structured detail", () => {
  test("multi-line messages collapse to the first line in toast copy", () => {
    const presented = presentError(new Error("first line\nsecond line\nthird line"));
    assert.equal(presented.message, "first line");
    assert.equal(presented.detail, "first line\nsecond line\nthird line");
  });

  test("engine fault-domain codes pass through", () => {
    const err = Object.assign(new Error("validation failed"), { code: "GF_VALIDATION" });
    const presented = presentError(err);
    assert.equal(presented.code, "GF_VALIDATION");
  });

  test("non-GF codes are ignored", () => {
    const err = Object.assign(new Error("boom"), { code: "ENOENT" });
    assert.equal(presentError(err).code, undefined);
  });

  test("non-Error values are stringified", () => {
    assert.equal(presentError("plain string failure").detail, "plain string failure");
    assert.equal(errorMessage(42), "42");
  });
});

suite("oneLineSummary", () => {
  test("truncates long single lines to the bound with an ellipsis", () => {
    const long = "x".repeat(200);
    const summary = oneLineSummary(long);
    assert.equal(summary.length, 120);
    assert.ok(summary.endsWith("…"));
  });

  test("leaves short messages untouched", () => {
    assert.equal(oneLineSummary("short"), "short");
  });
});

suite("engineErrorCode", () => {
  test("extracts GF_ codes from error-like objects", () => {
    assert.equal(
      engineErrorCode(Object.assign(new Error("x"), { code: "GF_UNSUPPORTED_PROJECT_FORMAT" })),
      "GF_UNSUPPORTED_PROJECT_FORMAT",
    );
    assert.equal(engineErrorCode(new Error("x")), undefined);
    assert.equal(engineErrorCode(null), undefined);
  });
});
