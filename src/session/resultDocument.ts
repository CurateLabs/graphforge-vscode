import * as fs from "node:fs/promises";
import { renameSync } from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { projectArtifactFileName } from "./projectArtifacts";
import { RESULT_METADATA_FORMAT, RESULT_METADATA_BYTES, resultMetadataPath } from "./resultMetadata";
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

function resultMetadata(result: QueryResult) {
  return {
    rowCount: result.rowCount,
    ...(result.sourceQuery ? { sourceQuery: result.sourceQuery } : {}),
    ...(result.ipc ? { arrowSha256: createHash("sha256").update(result.ipc).digest("hex"),
      numericColumns: result.numericColumns, generationUuid: result.generationUuid } : {}),
  };
}

function* jsonChunks(result: QueryResult, metadata = resultMetadata(result)): Iterable<string> {
  yield `{\n  "columns": ${JSON.stringify(result.columns)},\n  "rows": [`;
  for (let index = 0; index < result.rows.length; index++) {
    yield (index ? ",\n" : "\n") + JSON.stringify(result.rows[index], jsonReplacer, 2).replace(/^/gm, "    ");
  }
  yield result.rows.length ? "\n  ]" : "]";
  for (const [name, value] of Object.entries(metadata)) {
    if (value !== undefined) yield `,\n  ${JSON.stringify(name)}: ${JSON.stringify(value, jsonReplacer)}`;
  }
  yield "\n}\n";
}

/** Explicit string formatter for small/caller-requested documents; persistence streams chunks. */
export function formatQueryResultJson(result: QueryResult): string {
  return [...jsonChunks(result)].join("");
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
function* markdownChunks(result: QueryResult): Iterable<string> {
  const columnSummary = result.columns.length ? result.columns.map(column => `\`${column}\``).join(", ") : "_None_";
  yield `# GraphForge query result\n\n**Rows:** ${result.rowCount}\n\n**Columns:** ${columnSummary}\n\n`;
  if (!result.rows.length) {
    yield "## Results\n\n_No rows returned._\n";
  } else if (isTabular(result)) {
    yield `## Results\n\n| ${result.columns.map(escapeMarkdownCell).join(" | ")} |\n`;
    yield `| ${result.columns.map(() => "---").join(" | ")} |\n`;
    for (const row of result.rows) yield `| ${result.columns.map(column => escapeMarkdownCell(row[column])).join(" | ")} |\n`;
  } else {
    yield "## Structured results\n\n```json\n[";
    for (let index = 0; index < result.rows.length; index++)
      yield (index ? ",\n" : "\n") + JSON.stringify(result.rows[index], jsonReplacer, 2).replace(/^/gm, "  ");
    yield "\n]\n```\n";
  }
}

export function formatQueryResultMarkdown(result: QueryResult): string {
  return [...markdownChunks(result)].join("");
}

/** Bound the write buffer independently of result row count. */
async function writeChunks(file: string, chunks: Iterable<string>): Promise<string> {
  const output = await fs.open(file, "wx");
  const hash = createHash("sha256");
  let buffer = "";
  try {
    for (const chunk of chunks) {
      hash.update(chunk);
      buffer += chunk;
      if (buffer.length >= 64 * 1024) { await output.writeFile(buffer); buffer = ""; }
    }
    if (buffer) await output.writeFile(buffer);
  } finally { await output.close(); }
  return hash.digest("hex");
}

export async function persistQueryResultDocuments(
  projectRoot: string,
  result: QueryResult,
  name?: string,
  date = new Date(),
  canPublish?: () => boolean,
): Promise<ResultDocumentPaths> {
  const resultDir = path.join(projectRoot, RESULT_DOCUMENTS_DIR);
  const jsonPath = path.join(resultDir, QUERY_RESULT_JSON);
  const markdownPath = path.join(resultDir, QUERY_RESULT_MARKDOWN);
  const historyJsonPath = path.join(
    resultDir,
    projectArtifactFileName(name, "results", ".json", date),
  );
  const historyMarkdownPath = historyJsonPath.replace(/\.json$/i, ".md");
  await fs.mkdir(resultDir, { recursive: true });
  const staging = await fs.mkdtemp(path.join(resultDir, ".publish-"));
  const staged = (name: string) => path.join(staging, name);
  try {
    const metadata = resultMetadata(result);
    const jsonSha256 = await writeChunks(staged("json"), jsonChunks(result, metadata));
    await writeChunks(staged("markdown"), markdownChunks(result));
    const pointer = JSON.stringify({ format: RESULT_METADATA_FORMAT, ...metadata, jsonSha256 }) + "\n";
    if (Buffer.byteLength(pointer) > RESULT_METADATA_BYTES)
      throw new Error("RESULT_METADATA_TOO_LARGE: Use a shorter source query reference and run the query again.");
    await fs.writeFile(staged("metadata"), pointer);
    if (result.ipc) await fs.writeFile(staged("arrow"), result.ipc);
    const publications: Array<[string, string]> = [
      ...(result.ipc ? [
        ["arrow", jsonPath.replace(/\.json$/i, ".arrow")],
        ["arrow", historyJsonPath.replace(/\.json$/i, ".arrow")],
      ] as Array<[string, string]> : []),
      ["markdown", markdownPath], ["markdown", historyMarkdownPath],
      ["json", historyJsonPath], ["json", jsonPath],
      ["metadata", resultMetadataPath(historyJsonPath)], ["metadata", resultMetadataPath(jsonPath)],
    ];
    for (const [index, [source]] of publications.entries()) await fs.copyFile(staged(source), staged(String(index)));
    // No await during publication: a new metadata pointer is published last.
    // External/interrupted readers still fail closed on either content digest.
    if (canPublish && !canPublish())
      throw Object.assign(new Error("RESULT_PAGE_STALE: The project or result changed while saving. Inspect the current result before retrying."), { code: "RESULT_PAGE_STALE" });
    publications.forEach(([, target], index) => renameSync(staged(String(index)), target));
  } finally { await fs.rm(staging, { recursive: true, force: true }); }

  return { jsonPath, markdownPath, historyJsonPath, historyMarkdownPath };
}
