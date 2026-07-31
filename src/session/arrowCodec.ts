import { tableFromIPC, type Table } from "apache-arrow";
import type { QueryResult, TableRow } from "./types";

/**
 * Decode an Arrow IPC buffer (as returned by every `@graphforge/node` read call)
 * into plain rows. Pure / no vscode dependency so it is unit-testable with a
 * synthetic table standing in for engine output (e.g. an assertions page).
 */
export function decodeTable(buf: Buffer): QueryResult {
  const table = tableFromIPC(buf) as Table;
  const columns = table.schema.fields.map((f) => f.name);
  const rows: TableRow[] = [];
  for (let i = 0; i < table.numRows; i++) {
    const row: TableRow = {};
    for (const col of columns) {
      const child = table.getChild(col);
      row[col] = normalizeCell(child?.get(i));
    }
    rows.push(row);
  }
  const algorithm = table.schema.metadata?.get("graphforge.algorithm");
  return {
    columns,
    rows,
    rowCount: table.numRows,
    algorithm: algorithm ?? undefined,
  };
}

export function normalizeCell(value: unknown): unknown {
  if (value == null) {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return bufferToUuid(value) ?? value.toString("hex");
  }
  if (value instanceof Uint8Array) {
    return bufferToUuid(Buffer.from(value)) ?? Buffer.from(value).toString("hex");
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
}

export function bufferToUuid(buf: Buffer): string | undefined {
  if (buf.length !== 16) {
    return undefined;
  }
  const hex = buf.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function stringField(row: TableRow, key: string): string | undefined {
  const v = row[key];
  if (v == null) {
    return undefined;
  }
  return String(v);
}

/**
 * Resolve either a synchronous Buffer or a thenable (the real `@graphforge/node`
 * knowledge methods return AsyncTask/Promise) into a Promise<Buffer>. Keeps the
 * session layer working whether the sibling engine binding is sync or async for
 * a given method — it has moved between the two before.
 */
export async function resolveIpcBuffer(
  value: Buffer | PromiseLike<Buffer> | unknown,
): Promise<Buffer> {
  if (value && typeof (value as PromiseLike<Buffer>).then === "function") {
    return await (value as PromiseLike<Buffer>);
  }
  return value as Buffer;
}
