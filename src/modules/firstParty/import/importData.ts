export type ImportFormat = "csv" | "json" | "jsonl";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function record(value: unknown, index: number): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Record ${index + 1} must be a JSON object.`);
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!key.trim()) throw new Error(`Record ${index + 1} contains an empty property name.`);
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`Record ${index + 1} contains reserved property ${key}.`);
    }
    result[key] = item;
  }
  return result;
}

export function inferImportFormat(filePath: string): ImportFormat {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".jsonl") || lower.endsWith(".ndjson")) return "jsonl";
  if (lower.endsWith(".json")) return "json";
  throw new Error("Choose a .csv, .json, .jsonl, or .ndjson file.");
}

export function parseImportRecords(
  content: string,
  format: ImportFormat,
): Record<string, unknown>[] {
  if (format === "json") {
    const parsed = JSON.parse(content) as unknown;
    const values = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { records?: unknown }).records)
        ? (parsed as { records: unknown[] }).records
        : [parsed];
    return values.map(record);
  }
  if (format === "jsonl") {
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => record(JSON.parse(line) as unknown, index));
  }
  const rows = parseCsv(content);
  if (rows.length === 0) return [];
  const headers = rows[0].map((header) => header.trim());
  if (headers.some((header) => !header)) throw new Error("CSV headers cannot be empty.");
  if (new Set(headers).size !== headers.length) throw new Error("CSV headers must be unique.");
  return rows.slice(1).filter((row) => row.some((cell) => cell !== "")).map((row, index) => {
    if (row.length > headers.length) {
      throw new Error(`CSV row ${index + 2} has more values than the header.`);
    }
    return record(
      Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ""])),
      index,
    );
  });
}

/** RFC 4180-shaped parser with quoted commas, escaped quotes, and newlines. */
function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (quoted) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("CSV ends inside a quoted field.");
  if (field !== "" || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

export function cypherIdentifier(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("A node label is required.");
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error("Node labels cannot contain control characters.");
  }
  return `\`${trimmed.replace(/`/g, "``")}\``;
}

export function buildNodeImportCypher(
  label: string,
  mode: "create" | "merge",
  idColumn?: string,
): string {
  const nodeLabel = cypherIdentifier(label);
  if (mode === "merge") {
    if (!idColumn?.trim()) throw new Error("Merge imports require an ID column.");
    const property = cypherIdentifier(idColumn);
    return [
      "UNWIND $rows AS row",
      `MERGE (n:${nodeLabel} {${property}: row.${property}})`,
      "SET n += row",
      "RETURN count(n) AS imported",
    ].join("\n");
  }
  return [
    "UNWIND $rows AS row",
    `CREATE (n:${nodeLabel})`,
    "SET n += row",
    "RETURN count(n) AS imported",
  ].join("\n");
}

