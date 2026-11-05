import * as fs from "node:fs/promises";
import { renameSync } from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { projectArtifactFileName } from "./projectArtifacts";
import type { QueryResult } from "./types";

export const RESULT_DOCUMENTS_DIR = "results";
export const QUERY_RESULT_JSON = "query-result.json";
export const QUERY_RESULT_MARKDOWN = "query-result.md";

export interface ResultDocumentPaths {
  jsonPath: string;
  markdownPath: string;
  historyJsonPath?: string;
  historyMarkdownPath?: string;
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

/** Canonical, agent-copyable result document required by FR-2. */
export function formatQueryResultJson(result: QueryResult): string {
  return `${JSON.stringify(
    { columns: result.columns, rows: result.rows, rowCount: result.rowCount,
      ...(result.sourceQuery ? { sourceQuery: result.sourceQuery } : {}),
      ...(result.ipc ? { arrowSha256: createHash('sha256').update(result.ipc).digest('hex'), numericColumns: result.numericColumns, generationUuid: result.generationUuid } : {}),
    },
    jsonReplacer,
    2,
  )}\n`;
}

function isScalar(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  );
}

function isTabular(result: QueryResult): boolean {
  if (result.columns.length === 0) {
    return false;
  }
  const columnSet = new Set(result.columns);
  return result.rows.every(
    (row) =>
      Object.keys(row).every((key) => columnSet.has(key)) &&
      result.columns.every((column) => isScalar(row[column])),
  );
}

function escapeMarkdownCell(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  const text = value === null ? "null" : String(value);
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

/**
 * Human-facing companion document. Scalar rows render as a Markdown table;
 * nested/mixed rows stay structured as pretty JSON instead of becoming
 * "[object Object]" cells or one quoted raw-output string.
 */
export function formatQueryResultMarkdown(result: QueryResult): string {
  const columnSummary =
    result.columns.length > 0
      ? result.columns.map((column) => `\`${column}\``).join(", ")
      : "_None_";
  const lines = [
    "# GraphForge query result",
    "",
    `**Rows:** ${result.rowCount}`,
    "",
    `**Columns:** ${columnSummary}`,
    "",
  ];

  if (result.rows.length === 0) {
    lines.push("## Results", "", "_No rows returned._", "");
    return lines.join("\n");
  }

  if (isTabular(result)) {
    lines.push(
      "## Results",
      "",
      `| ${result.columns.map(escapeMarkdownCell).join(" | ")} |`,
      `| ${result.columns.map(() => "---").join(" | ")} |`,
    );
    for (const row of result.rows) {
      lines.push(
        `| ${result.columns.map((column) => escapeMarkdownCell(row[column])).join(" | ")} |`,
      );
    }
    lines.push("");
    return lines.join("\n");
  }

  lines.push(
    "## Structured results",
    "",
    "These rows contain nested or mixed values, so they are shown as structured JSON.",
    "",
    "```json",
    JSON.stringify(result.rows, jsonReplacer, 2),
    "```",
    "",
  );
  return lines.join("\n");
}

/** Write both durable and readable result documents inside the GraphForge project. */
export async function persistQueryResultDocuments(
  projectRoot: string,
  result: QueryResult,
  name?: string,
  date = new Date(),
): Promise<ResultDocumentPaths> {
  const resultDir = path.join(projectRoot, RESULT_DOCUMENTS_DIR);
  const jsonPath = path.join(resultDir, QUERY_RESULT_JSON);
  const markdownPath = path.join(resultDir, QUERY_RESULT_MARKDOWN);
  const historyJsonPath = path.join(
    resultDir,
    projectArtifactFileName(name, "results", ".json", date),
  );
  const historyMarkdownPath = historyJsonPath.replace(/\.json$/i, ".md");
  const json = formatQueryResultJson(result);
  const markdown = formatQueryResultMarkdown(result);

  await fs.mkdir(resultDir, { recursive: true });
  const publications: Array<[string, string | Uint8Array]> = [
    ...(result.ipc ? [
      [jsonPath.replace(/\.json$/i, ".arrow"), result.ipc],
      [historyJsonPath.replace(/\.json$/i, ".arrow"), result.ipc],
    ] as Array<[string, Uint8Array]> : []),
    [markdownPath, markdown],
    [historyMarkdownPath, markdown],
    [historyJsonPath, json],
    [jsonPath, json],
  ];
  const staging = await fs.mkdtemp(path.join(resultDir, ".publish-"));
  try {
    await Promise.all(publications.map(([, contents], index) =>
      fs.writeFile(path.join(staging, String(index)), contents),
    ));
    // No await in publication: concurrent writers and synchronous result readers
    // cannot interleave a JSON/Arrow pair in this extension host. JSON is last;
    // the digest still fails closed for external reads or interrupted publication.
    publications.forEach(([target], index) => renameSync(path.join(staging, String(index)), target));
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }

  return { jsonPath, markdownPath, historyJsonPath, historyMarkdownPath };
}
