import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  AGENT_CONTEXT_FORMAT,
  ARTIFACT_INDEX_FORMAT,
  buildAgentProjectContext,
} from "../session/agentContext";
import { PROJECT_FORMAT_BYTES } from "../session/types";

suite("agent context", () => {
  test("returns absolute artifact and durable last-result paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gf-agent-context-"));
    fs.writeFileSync(path.join(root, "FORMAT"), PROJECT_FORMAT_BYTES);
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# Agent contract\n");
    fs.mkdirSync(path.join(root, "queries"), { recursive: true });
    fs.mkdirSync(path.join(root, "results"), { recursive: true });
    fs.mkdirSync(path.join(root, "visualizations"), { recursive: true });
    fs.mkdirSync(path.join(root, "mutations"), { recursive: true });
    fs.writeFileSync(path.join(root, "queries", "nodes.cypher"), "MATCH (n) RETURN n\n");
    fs.writeFileSync(
      path.join(root, "results", "query-result.json"),
      JSON.stringify({ columns: ["id"], rows: [{ id: "a" }], rowCount: 1 }),
    );
    fs.writeFileSync(
      path.join(root, "results", "results-20260801-010101-000.json"),
      JSON.stringify({ columns: ["id"], rows: [{ id: "a" }], rowCount: 1 }),
    );

    const context = buildAgentProjectContext(root, {
      name: "fixture",
      hasLastResult: true,
    });

    assert.equal(AGENT_CONTEXT_FORMAT, "graphforge.agent-context/v1");
    assert.equal(ARTIFACT_INDEX_FORMAT, "graphforge.artifact-index/v1");
    assert.equal(context.marker.valid, true);
    assert.equal(context.marker.expected, "graphforge-project/v1\n");
    assert.equal(context.instructionsPath, path.join(root, "AGENTS.md"));
    assert.equal(context.artifacts.queries[0]?.path, "queries/nodes.cypher");
    assert.equal(
      context.artifacts.queries[0]?.absolutePath,
      path.join(root, "queries", "nodes.cypher"),
    );
    assert.equal(context.lastResult.inMemory, true);
    assert.equal(context.lastResult.exists, true);
    assert.equal(
      context.lastResult.canonicalJsonPath,
      path.join(root, "results", "query-result.json"),
    );
    assert.equal(
      context.lastResult.latestHistoryPath,
      path.join(root, "results", "results-20260801-010101-000.json"),
    );
  });

  test("reports an invalid marker without throwing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gf-agent-invalid-"));
    fs.writeFileSync(path.join(root, "FORMAT"), "not-graphforge\n");

    const context = buildAgentProjectContext(root);

    assert.equal(context.marker.valid, false);
    assert.equal(context.lastResult.exists, false);
    assert.deepEqual(context.artifacts.queries, []);
  });
});
