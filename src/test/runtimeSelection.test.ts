import * as assert from "node:assert/strict";
import { chooseRuntime, describeRuntimeUnavailable } from "../session/runtimeSelection";

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

suite("describeRuntimeUnavailable", () => {
  test("mentions both setup commands when neither runtime is usable", () => {
    const message = describeRuntimeUnavailable("auto", nodeMissing, pythonMissing);
    assert.match(message, /Setup Native Binding/);
    assert.match(message, /Setup Python Binding/);
    assert.match(message, /no candidates/);
    assert.match(message, /no interpreter/);
  });

  test("reports Node as ok when only Python is missing", () => {
    const message = describeRuntimeUnavailable("auto", nodeOk, pythonMissing);
    assert.match(message, /Node: ok/);
    assert.match(message, /Setup Python Binding/);
  });
});
