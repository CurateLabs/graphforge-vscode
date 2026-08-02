import * as assert from "node:assert/strict";
import {
  chooseRuntime,
  describeRuntimeUnavailable,
  summarizeNodeUnavailable,
  summarizePythonUnavailable,
} from "../session/runtimeSelection";

const nodeOk = { available: true };
const nodeMissing = { available: false, error: "no candidates" };
const pythonOk = { available: true, interpreter: "/usr/bin/python3", graphforgeVersion: "0.5.0" };
const pythonMissing = { available: false, error: "no interpreter" };

suite("chooseRuntime", () => {
  test("auto prefers Node when both are available", () => {
    assert.equal(chooseRuntime("auto", nodeOk, pythonOk), "node");
  });

  test("auto falls back to Python when Node is unavailable", () => {
    assert.equal(chooseRuntime("auto", nodeMissing, pythonOk), "python");
  });

  test("auto returns undefined when neither runtime is usable", () => {
    assert.equal(chooseRuntime("auto", nodeMissing, pythonMissing), undefined);
  });

  test("explicit node preference never falls back to python", () => {
    assert.equal(chooseRuntime("node", nodeMissing, pythonOk), undefined);
    assert.equal(chooseRuntime("node", nodeOk, pythonOk), "node");
  });

  test("explicit python preference never falls back to node", () => {
    assert.equal(chooseRuntime("python", nodeOk, pythonMissing), undefined);
    assert.equal(chooseRuntime("python", nodeOk, pythonOk), "python");
  });

  test("defaults to ambiguous project kind (pre-existing Node-first auto behavior)", () => {
    assert.equal(chooseRuntime("auto", nodeOk, pythonOk), "node");
  });

  test("auto prefers Python in a Python-first workspace even when Node is available", () => {
    assert.equal(chooseRuntime("auto", nodeOk, pythonOk, "python"), "python");
  });

  test("auto still prefers Node in a Node-ish workspace", () => {
    assert.equal(chooseRuntime("auto", nodeOk, pythonOk, "node"), "node");
  });

  test("auto still prefers Node in an ambiguous workspace", () => {
    assert.equal(chooseRuntime("auto", nodeOk, pythonOk, "ambiguous"), "node");
  });

  test("auto falls back to Node when project kind is python but Python is unusable", () => {
    assert.equal(chooseRuntime("auto", nodeOk, pythonMissing, "python"), "node");
  });

  test("auto returns undefined when project kind is python, Python unusable, and Node unavailable", () => {
    assert.equal(chooseRuntime("auto", nodeMissing, pythonMissing, "python"), undefined);
  });

  test("explicit node/python preference ignores project kind entirely", () => {
    assert.equal(chooseRuntime("node", nodeOk, pythonOk, "python"), "node");
    assert.equal(chooseRuntime("python", nodeMissing, pythonMissing, "python"), undefined);
  });
});

/**
 * Representative raw loader failures (#27): the Node `require()` dump with
 * its `Require stack:` and the Python loader's joined multi-interpreter
 * probe blob. The curated tooltip must never surface either verbatim.
 */
const nodeRawRequireFailure = {
  available: false,
  error:
    "GraphForge native binding unavailable. Tried: @curatelabs/graphforge: Cannot find module '@curatelabs/graphforge'\n" +
    "Require stack:\n" +
    "- /home/user/.vscode/extensions/curatelabsai.graphforge-0.1.0/dist/extension.js",
};

const pythonRawProbeFailure = {
  available: false,
  interpreter: "/usr/bin/python3",
  error:
    "graphforge not importable in any detected interpreter. Tried: " +
    "/usr/bin/python3 (path): ModuleNotFoundError: No module named 'graphforge' | " +
    "/workspace/.venv/bin/python (venv): ModuleNotFoundError: No module named 'graphforge'",
};

suite("describeRuntimeUnavailable (#27 curated tooltip)", () => {
  test("mentions both setup commands when neither runtime is usable", () => {
    const message = describeRuntimeUnavailable("auto", nodeMissing, pythonMissing);
    assert.match(message, /Setup Native Binding/);
    assert.match(message, /Setup Python Binding/);
    assert.match(message, /Check Environment/);
  });

  test("reports Node as ok when only Python is missing", () => {
    const message = describeRuntimeUnavailable("auto", nodeOk, pythonMissing);
    assert.match(message, /Node: ok/);
    assert.match(message, /Setup Python Binding/);
  });

  test("is at most 3 short lines", () => {
    const message = describeRuntimeUnavailable(
      "auto",
      nodeRawRequireFailure,
      pythonRawProbeFailure,
    );
    const lines = message.split("\n");
    assert.ok(lines.length <= 3, `expected <= 3 lines, got ${lines.length}`);
    for (const line of lines) {
      assert.ok(line.length <= 120, `line too long: ${line}`);
    }
  });

  test("never leaks raw require() diagnostics from the Node loader", () => {
    const message = describeRuntimeUnavailable(
      "auto",
      nodeRawRequireFailure,
      pythonRawProbeFailure,
    );
    assert.ok(!message.includes("Require stack:"), "tooltip leaked Require stack");
    assert.ok(!message.includes("Cannot find module"), "tooltip leaked require noise");
    assert.ok(!message.includes("Tried:"), "tooltip leaked the joined candidate list");
    assert.match(message, /@curatelabs\/graphforge is not installed or linked/);
  });

  test("never leaks the joined multi-interpreter Python probe blob", () => {
    const message = describeRuntimeUnavailable(
      "auto",
      nodeRawRequireFailure,
      pythonRawProbeFailure,
    );
    assert.ok(!message.includes("ModuleNotFoundError"), "tooltip leaked raw Python probe error");
    assert.ok(!message.includes("/usr/bin/python3 (path)"), "tooltip leaked candidate list");
    assert.match(message, /graphforge is not installed in the detected interpreter\(s\)/);
  });

  test("still starts with the fail-closed 'No usable GraphForge runtime' headline", () => {
    // `runtime.ts` throws this string; `presentError` keys setup detection
    // off this prefix, so it is part of the contract.
    const message = describeRuntimeUnavailable("node", nodeMissing, pythonOk);
    assert.ok(message.startsWith("No usable GraphForge runtime"));
    assert.match(message, /preference "node"/);
  });
});

suite("summarizeNodeUnavailable / summarizePythonUnavailable", () => {
  test("summarizes missing-module require errors", () => {
    assert.equal(
      summarizeNodeUnavailable(nodeRawRequireFailure.error),
      "@curatelabs/graphforge is not installed or linked",
    );
  });

  test("summarizes a module without the expected export", () => {
    assert.equal(
      summarizeNodeUnavailable("GraphForge native binding unavailable. Tried: /x: no GraphForge export"),
      "installed module has no GraphForge export",
    );
  });

  test("falls back to a generic short phrase for unknown Node loader errors", () => {
    const summary = summarizeNodeUnavailable(
      "The module was compiled against a different Node.js version using NODE_MODULE_VERSION 108.",
    );
    assert.equal(summary, "binding failed to load");
  });

  test("summarizes no-interpreter and not-importable Python failures", () => {
    assert.equal(
      summarizePythonUnavailable(
        "No Python interpreter detected (no workspace venv, no ms-python.python selection, no python3/python on PATH).",
      ),
      "no Python interpreter detected",
    );
    assert.equal(
      summarizePythonUnavailable(pythonRawProbeFailure.error),
      "graphforge is not installed in the detected interpreter(s)",
    );
    assert.equal(summarizePythonUnavailable(undefined), "no interpreter");
  });
});
