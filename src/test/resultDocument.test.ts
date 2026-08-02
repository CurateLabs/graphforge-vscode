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
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gf-result-doc-"));
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
    assert.match(fs.readFileSync(documents.markdownPath, "utf8"), /\| ATL \| AUS \| 813 \|/);
    assert.ok(documents.historyJsonPath);
    assert.ok(documents.historyMarkdownPath);
    assert.ok(fs.existsSync(documents.historyJsonPath));
    assert.ok(fs.existsSync(documents.historyMarkdownPath));
    assert.equal(
      path.basename(documents.historyJsonPath),
      "results-20260802-052907-123.json",
    );
  });

  test("uses and sanitizes an optional result name", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gf-named-result-"));
    const documents = await persistQueryResultDocuments(
      projectRoot,
      { columns: [], rows: [], rowCount: 0 },
      "Regional Routes",
    );
    assert.equal(path.basename(documents.historyJsonPath!), "regional-routes.json");
    assert.equal(path.basename(documents.historyMarkdownPath!), "regional-routes.md");
  });
});
