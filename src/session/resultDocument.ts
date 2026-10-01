import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { projectArtifactFileName } from "./projectArtifacts";
import type { QueryResult } from "./types";

export const RESULT_DOCUMENTS_DIR = "results";
export const QUERY_RESULT_JSON = "query-result.json";
export const QUERY_RESULT_MARKDOWN = "query-result.md";
export const QUERY_RESULT_ARROW = "query-result.arrow";

export interface ResultDocumentPaths {
  jsonPath: string;
  markdownPath: string;
  /** Exact engine Arrow IPC bytes, when the engine result was available. */
  arrowPath?: string;
  historyJsonPath?: string;
  historyMarkdownPath?: string;
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

/** Canonical, agent-copyable result document required by FR-2. */
export function formatQueryResultJson(result: QueryResult): string {
  return `${JSON.stringify(
    {
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      ...(result.schema ? { schema: result.schema } : {}),
      ...(result.provenance ? { provenance: result.provenance } : {}),
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

/** SHA-256 (hex) binding a JSON result document to its `.arrow` bytes. */
export function ipcSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The `.arrow` document that sits beside a result JSON document. */
export function arrowPathFor(jsonPath: string): string {
  return jsonPath.replace(/\.json$/i, ".arrow");
}

/**
 * Write the durable and readable result documents inside the GraphForge
 * project. With the engine's Arrow IPC bytes, a `.arrow` document is written
 * beside each JSON document and its SHA-256 recorded in the JSON provenance,
 * so a reopened result can be composed by XYG from the exact engine bytes.
 */
export async function persistQueryResultDocuments(
  projectRoot: string,
  result: QueryResult,
  name?: string,
  date = new Date(),
  ipc?: Uint8Array,
): Promise<ResultDocumentPaths> {
  if (ipc && result.provenance) {
    result = { ...result, provenance: { ...result.provenance, ipcSha256: ipcSha256(ipc) } };
  }
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
  const writes = [
    fs.writeFile(jsonPath, json, "utf8"),
    fs.writeFile(markdownPath, markdown, "utf8"),
    fs.writeFile(historyJsonPath, json, "utf8"),
    fs.writeFile(historyMarkdownPath, markdown, "utf8"),
  ];
  const arrowPath = ipc && result.provenance ? arrowPathFor(jsonPath) : undefined;
  if (arrowPath && ipc) {
    writes.push(fs.writeFile(arrowPath, ipc), fs.writeFile(arrowPathFor(historyJsonPath), ipc));
  } else {
    // A JSON-only result must not pair with a previous run's bytes.
    writes.push(fs.rm(arrowPathFor(jsonPath), { force: true }));
  }
  await Promise.all(writes);

  return arrowPath
    ? { jsonPath, markdownPath, arrowPath, historyJsonPath, historyMarkdownPath }
    : { jsonPath, markdownPath, historyJsonPath, historyMarkdownPath };
}
