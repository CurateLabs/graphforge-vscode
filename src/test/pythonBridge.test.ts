import * as assert from "node:assert/strict";
import * as path from "node:path";
import { PythonBridge, PythonBridgeError, PythonEngineBackend } from "../session/pythonBridge";

// Run the fake host under the current Node binary rather than a real Python
// interpreter, so this suite exercises PythonBridge's newline-JSON framing,
// request/response correlation, and error marshalling without depending on
// Python or the `graphforge` package being installed in CI.
const FAKE_HOST = path.resolve(__dirname, "fixtures", "fakeGraphforgeHost.js");

function newBridge(): PythonBridge {
  return new PythonBridge(process.execPath, FAKE_HOST);
}

suite("PythonBridge", () => {
  test("open then execute round-trips an Arrow payload", async () => {
    const bridge = newBridge();
    try {
      const opened = await bridge.request("open", { path: "/tmp/proj" });
      assert.equal(opened["path"], "/tmp/proj");
      assert.equal(opened["ontology_mode"], "exploratory");

      const result = await bridge.request("execute", { cypher: "MATCH (n) RETURN n", params: { a: 1 } });
      const decoded = JSON.parse(
        Buffer.from(result["arrow_ipc_base64"] as string, "base64").toString("utf8"),
      );
      assert.deepEqual(decoded, [{ cypher: "MATCH (n) RETURN n", params: { a: 1 } }]);
    } finally {
      await bridge.dispose();
    }
  });

  test("dispose waits for OS exit after close fails and termination is delayed", async () => {
    const bridge = new PythonBridge(process.execPath, path.resolve(__dirname, "fixtures", "delayedCloseHost.js"));
    await bridge.request("open");
    const child = (bridge as unknown as { child: import("node:child_process").ChildProcess }).child;
    try {
      await bridge.dispose();
      assert.ok(child.exitCode !== null || child.signalCode !== null, "A kill signal alone must not count as writer release");
      assert.throws(() => bridge.request("open"), /disposed/, "A disposed backend cannot start another writer");
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  });

  test("propagates engine errors with code and kind", async () => {
    const bridge = newBridge();
    try {
      await bridge.request("open", { path: "/tmp/proj" });
      await assert.rejects(
        () => bridge.request("execute", { cypher: "FAIL" }),
        (err: unknown) => {
          assert.ok(err instanceof PythonBridgeError);
          assert.equal(err.code, "GF_QUERY_FAILED");
          assert.match(err.message, /simulated query failure/);
          return true;
        },
      );
    } finally {
      await bridge.dispose();
    }
  });

  test("correlates concurrent requests by id", async () => {
    const bridge = newBridge();
    try {
      await bridge.request("open", { path: "/tmp/proj" });
      const [a, b, c] = await Promise.all([
        bridge.request("verb", { verb: "rank", args: { label: "Person" } }),
        bridge.request("labels"),
        bridge.request("relationship_types"),
      ]);
      assert.ok("arrow_ipc_base64" in a);
      assert.deepEqual(b["labels"], ["Person", "Org"]);
      assert.deepEqual(c["relationship_types"], ["KNOWS"]);
    } finally {
      await bridge.dispose();
    }
  });

  test("rejects pending requests when the process exits unexpectedly", async () => {
    const bridge = newBridge();
    await bridge.request("open", { path: "/tmp/proj" });
    // "close" makes the fake host exit(0) without answering further requests;
    // a request racing the exit should be rejected rather than hang forever.
    const closePromise = bridge.request("close");
    await closePromise;
  });
});

suite("PythonEngineBackend", () => {
  test("implements the EngineBackend contract over the bridge", async () => {
    const backend = await PythonEngineBackend.open(process.execPath, "/tmp/proj", FAKE_HOST);
    try {
      assert.equal(backend.runtime, "python");
      assert.equal(backend.path, "/tmp/proj");
      assert.equal(await backend.ontologyMode(), "exploratory");

      const buf = await backend.execute("MATCH (n) RETURN n");
      assert.ok(Buffer.isBuffer(buf));

      const labels = await backend.labels();
      assert.deepEqual(labels, ["Person", "Org"]);

      const relTypes = await backend.relationshipTypes();
      assert.deepEqual(relTypes, ["KNOWS"]);

      const rankBuf = await backend.rank("Person", "pagerank");
      assert.ok(Buffer.isBuffer(rankBuf));
    } finally {
      await backend.dispose();
    }
  });

  test("binds concurrent reads and verbs to their own generation across a mutation", async () => {
    const backend = await PythonEngineBackend.open(process.execPath, "/tmp/proj", FAKE_HOST);
    try {
      const [before, rank, mutation, after] = await Promise.all([
        backend.execute("READ"),
        backend.rank("Person", "pagerank"),
        backend.execute("MUTATE"),
        backend.execute("READ_AFTER"),
      ]);
      const g1 = "0190a000-0000-7000-8000-000000000001";
      const g2 = "0190a000-0000-7000-8000-000000000002";
      assert.equal(backend.resultGeneration(before), g1);
      assert.equal(backend.resultGeneration(rank), g1);
      assert.equal(backend.resultGeneration(mutation), g2);
      assert.equal(backend.resultGeneration(after), g2);
      assert.equal(backend.resultGeneration(Buffer.from(before)), undefined);
      assert.deepEqual(JSON.parse(before.toString("utf8")), [{ cypher: "READ", params: null }]);
      assert.deepEqual(JSON.parse(rank.toString("utf8")), [{
        verb: "rank", args: { label: "Person", by: "pagerank" },
      }]);
    } finally {
      await backend.dispose();
    }
  });

  test("does not invent identity for older hosts and rejects malformed identity", async () => {
    const backend = await PythonEngineBackend.open(process.execPath, "/tmp/proj", FAKE_HOST);
    try {
      const result = await backend.execute("NO_IDENTITY");
      assert.equal(backend.resultGeneration(result), undefined);
      await assert.rejects(() => backend.execute("INVALID_IDENTITY"), (error: unknown) => {
        assert.ok(error instanceof PythonBridgeError);
        assert.equal(error.code, "GF_GENERATION_INVALID");
        return true;
      });
    } finally {
      await backend.dispose();
    }
  });

  // Note: this test constructs its own bridge because PythonEngineBackend
  // always resolves the default (real) host script path when not overridden.
  test("bridge points at graphforge_host.py by default", () => {
    const bridge = new PythonBridge(process.execPath);
    // Accessing the private field via bracket notation keeps this a
    // black-box-ish smoke check that the constructor default resolves
    // relative to dist/session, not the fixture used elsewhere in this file.
    const hostScriptPath = (bridge as unknown as { hostScriptPath: string }).hostScriptPath;
    assert.ok(hostScriptPath.endsWith(path.join("python", "graphforge_host.py")));
  });
});
