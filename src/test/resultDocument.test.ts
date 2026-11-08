import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  formatQueryResultJson,
  formatQueryResultMarkdown,
  persistQueryResultDocuments,
  QUERY_RESULT_JSON,
  QUERY_RESULT_MARKDOWN,
  RESULT_DOCUMENTS_DIR,
} from "../session/resultDocument";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import { readProjectResult } from "../session/projectArtifacts";
import { decodeTable } from "../session/arrowCodec";
import { resultMetadataPath, LEGACY_RESULT_BYTES } from "../session/resultMetadata";
import type { QueryResult } from "../session/types";

suite("query result documents", () => {
  test("formats homogeneous scalar rows as a Markdown table", () => {
    const result: QueryResult = {
      columns: ["airport", "distance", "note"],
      rows: [
        { airport: "ATL", distance: 594, note: "busy | hub" },
        { airport: "AUS", distance: 813, note: "line 1\nline 2" },
      ],
      rowCount: 2,
    };

    const markdown = formatQueryResultMarkdown(result);

    assert.match(markdown, /\| airport \| distance \| note \|/);
    assert.match(markdown, /\| ATL \| 594 \| busy \\\| hub \|/);
    assert.match(markdown, /line 1<br>line 2/);
    assert.doesNotMatch(markdown, /\[object Object\]/);
  });

  test("formats nested and mixed values as pretty structured JSON", () => {
    const result: QueryResult = {
      columns: ["node", "tags", "score"],
      rows: [
        {
          node: { id: "airport-1", properties: { code: "ATL" } },
          tags: ["hub", "us"],
          score: 10n,
        },
      ],
      rowCount: 1,
    };

    const markdown = formatQueryResultMarkdown(result);

    assert.match(markdown, /## Structured results/);
    assert.match(markdown, /```json/);
    assert.match(markdown, /"code": "ATL"/);
    assert.match(markdown, /"tags": \[\n\s+"hub"/);
    assert.match(markdown, /"score": "10"/);
    assert.doesNotMatch(markdown, /\[object Object\]/);
  });

  test("keeps the canonical JSON result agent-copyable", () => {
    const text = formatQueryResultJson({
      columns: ["count"],
      rows: [{ count: 12n }],
      rowCount: 1,
    });

    assert.deepEqual(JSON.parse(text), {
      columns: ["count"],
      rows: [{ count: "12" }],
      rowCount: 1,
    });
    assert.ok(text.endsWith("\n"));
  });

  test("persists JSON and readable Markdown under the project root", async () => {
    const projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "gf-result-doc-"),
    );
    const result: QueryResult = {
      columns: ["source", "target", "dist"],
      rows: [{ source: "ATL", target: "AUS", dist: 813 }],
      rowCount: 1,
    };

    const documents = await persistQueryResultDocuments(
      projectRoot,
      result,
      undefined,
      new Date("2026-08-02T05:29:07.123Z"),
    );

    assert.equal(
      documents.jsonPath,
      path.join(projectRoot, RESULT_DOCUMENTS_DIR, QUERY_RESULT_JSON),
    );
    assert.equal(
      documents.markdownPath,
      path.join(projectRoot, RESULT_DOCUMENTS_DIR, QUERY_RESULT_MARKDOWN),
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(documents.jsonPath, "utf8")), {
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
    });
    assert.match(
      fs.readFileSync(documents.markdownPath, "utf8"),
      /\| ATL \| AUS \| 813 \|/,
    );
    assert.ok(documents.historyJsonPath);
    assert.ok(documents.historyMarkdownPath);
    assert.ok(fs.existsSync(documents.historyJsonPath));
    assert.ok(fs.existsSync(documents.historyMarkdownPath));
    assert.equal(
      path.basename(documents.historyJsonPath),
      "results-20260802-052907-123.json",
    );
  });

  test("reopens matching Arrow and rejects replacement bytes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gf-arrow-pair-"));
    try {
      const ipc = tableToIPC(tableFromArrays({ count: BigInt64Array.of(12n) }));
      const docs = await persistQueryResultDocuments(root, {
        columns: ["count"],
        rows: [{ count: "12" }],
        rowCount: 1,
        ipc,
        numericColumns: ["count"],
        generationUuid: "generation",
        sourceQuery: "queries/templates/original.cypher",
      });
      const reopened = readProjectResult(root, docs.jsonPath);
      assert.deepEqual([...reopened.ipc!], [...ipc]);
      assert.deepEqual(reopened.numericColumns, ["count"]);
      assert.equal(reopened.generationUuid, "generation");
      assert.equal(reopened.sourceQuery, "queries/templates/original.cypher");
      const readable = JSON.parse(fs.readFileSync(docs.jsonPath, "utf8"));
      readable.rows = [{ count: "forged" }];
      readable.numericColumns = ["fake"];
      fs.writeFileSync(docs.jsonPath, JSON.stringify(readable));
      assert.deepEqual(readProjectResult(root, docs.jsonPath).rows, [
        { count: "12" },
      ]);
      fs.writeFileSync(
        docs.jsonPath.replace(/\.json$/, ".arrow"),
        Uint8Array.of(5, 6),
      );
      assert.throws(
        () => readProjectResult(root, docs.jsonPath),
        /XYG_RESULT_MISMATCH/,
      );
      fs.unlinkSync(docs.jsonPath.replace(/\.json$/, ".arrow"));
      assert.throws(() => readProjectResult(root, docs.jsonPath), /ENOENT/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("concurrent saves publish coherent current and history Arrow pairs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gf-concurrent-results-"));
    try {
      const results = Array.from({ length: 12 }, (_, value) => {
        const ipc = tableToIPC(tableFromArrays({ value: Int32Array.from({ length: 1000 }, () => value) }));
        return { columns: ["value"], rows: Array.from({ length: 1000 }, () => ({ value })), rowCount: 1000, ipc };
      });
      const saved = await Promise.all(results.map((result, index) =>
        persistQueryResultDocuments(root, result, `result-${index}`),
      ));
      const latest = readProjectResult(root, saved[0].jsonPath);
      const currentValue = latest.rows[0].value;
      assert.ok(latest.rows.every(row => row.value === currentValue));
      for (let index = 0; index < saved.length; index++) {
        const reopened = readProjectResult(root, saved[index].historyJsonPath!);
        assert.deepEqual(reopened.rows, results[index].rows);
        assert.deepEqual([...reopened.ipc!], [...results[index].ipc]);
      }
      assert.ok(!fs.readdirSync(path.join(root, "results")).some(file => file.startsWith(".publish-")));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test("streams complete multi-page documents and reopens Arrow without reading the JSON companion", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gf-stream-result-"));
    try {
      const ipc = Buffer.from(tableToIPC(tableFromArrays({ value: Int32Array.from({ length: 1203 }, (_, index) => index) })));
      const docs = await persistQueryResultDocuments(root, decodeTable(ipc));
      const saved = JSON.parse(fs.readFileSync(docs.jsonPath, "utf8"));
      assert.equal(saved.rows.length, 1203);
      assert.deepEqual(saved.rows[1202], { value: 1202 });
      assert.match(fs.readFileSync(docs.markdownPath, "utf8"), /\| 1202 \|/);
      fs.writeFileSync(docs.jsonPath, "not JSON".repeat(LEGACY_RESULT_BYTES));
      const reopened = readProjectResult(root, docs.jsonPath);
      assert.equal(reopened.rowCount, 1203);
      assert.deepEqual(reopened.rows[1202], { value: 1202 });
      assert.deepEqual(reopened.ipc, ipc);
      fs.writeFileSync(resultMetadataPath(docs.jsonPath), "{}");
      assert.throws(() => readProjectResult(root, docs.jsonPath), /RESULT_METADATA_INVALID/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test("keeps bounded legacy snapshots readable and gives a recovery action for oversized legacy JSON", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gf-legacy-result-"));
    try {
      const ipc = Buffer.from(tableToIPC(tableFromArrays({ value: [42] })));
      const docs = await persistQueryResultDocuments(root, decodeTable(ipc));
      fs.unlinkSync(resultMetadataPath(docs.jsonPath));
      assert.equal(readProjectResult(root, docs.jsonPath).rows[0].value, 42);
      fs.writeFileSync(docs.jsonPath, " ".repeat(LEGACY_RESULT_BYTES + 1));
      assert.throws(() => readProjectResult(root, docs.jsonPath), /RESULT_DOCUMENT_TOO_LARGE.*Run the query again/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test("publishing plain rows after Arrow never reuses the old sidecar", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gf-plain-after-arrow-"));
    try {
      const ipc = Buffer.from(tableToIPC(tableFromArrays({ value: [42] })));
      await persistQueryResultDocuments(root, decodeTable(ipc), "same");
      const docs = await persistQueryResultDocuments(root, { columns: ["value"], rows: [{ value: "plain" }], rowCount: 1 }, "same");
      assert.deepEqual(readProjectResult(root, docs.jsonPath).rows, [{ value: "plain" }]);
      assert.equal(readProjectResult(root, docs.jsonPath).ipc, undefined);
      fs.appendFileSync(docs.jsonPath, " ");
      assert.throws(() => readProjectResult(root, docs.jsonPath), /XYG_RESULT_MISMATCH/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test("uses and sanitizes an optional result name", async () => {
    const projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "gf-named-result-"),
    );
    const documents = await persistQueryResultDocuments(
      projectRoot,
      { columns: [], rows: [], rowCount: 0 },
      "Regional Routes",
    );
    assert.equal(
      path.basename(documents.historyJsonPath!),
      "regional-routes.json",
    );
    assert.equal(
      path.basename(documents.historyMarkdownPath!),
      "regional-routes.md",
    );
  });
});
