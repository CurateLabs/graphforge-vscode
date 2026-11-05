import { DataType, tableFromIPC, type Table, type Vector } from "apache-arrow";
import type { QueryResult, TableRow } from "./types";

/**
 * Decode an Arrow IPC buffer (as returned by every `@curatelabs/graphforge` read call)
 * into plain rows. Pure / no vscode dependency so it is unit-testable with a
 * synthetic table standing in for engine output (e.g. an assertions page).
 */
export function decodeTable(buf: Buffer): QueryResult {
  const table = tableFromIPC(buf) as Table;
  const columns = table.schema.fields.map((f) => f.name);
  const readers = columns.map((_, index) => cellReader(table.getChildAt(index)));
  const rows: TableRow[] = [];
  for (let i = 0; i < table.numRows; i++) {
    const row: TableRow = {};
    for (let column = 0; column < columns.length; column++) {
      row[columns[column]] = readers[column](i);
    }
    rows.push(row);
  }
  const algorithm = table.schema.metadata?.get("graphforge.algorithm");
  return {
    columns,
    rows,
    rowCount: table.numRows,
    algorithm: algorithm ?? undefined,
    ipc: buf,
    numericColumns: table.schema.fields.filter(f => DataType.isInt(f.type) || DataType.isFloat(f.type)).map(f => f.name),
  };
}

/** Read struct children directly, avoiding a lazy Arrow proxy and a second object copy per cell. */
function cellReader(vector: Vector | null): (index: number) => unknown {
  if (!vector) return () => undefined;
  if (
    DataType.isFloat(vector.type) ||
    (DataType.isInt(vector.type) && vector.type.bitWidth < 64)
  ) return vector.get.bind(vector);
  if (DataType.isStruct(vector.type)) {
    const fields = vector.type.children.map((field, index) => ({
      name: field.name,
      read: cellReader(vector.getChildAt(index)),
    }));
    return (index) => {
      if (!vector.isValid(index)) return null;
      const row: TableRow = {};
      for (const field of fields) {
        const value = field.read(index);
        if (field.name === "__proto__") {
          Object.defineProperty(row, field.name, {
            value, enumerable: true, configurable: true, writable: true,
          });
        } else row[field.name] = value;
      }
      return row;
    };
  }
  return (index) => normalizeCell(vector.get(index));
}

export function normalizeCell(value: unknown): unknown {
  if (value == null || (typeof value !== "object" && typeof value !== "bigint")) {
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
  if (Array.isArray(value)) return value.map(normalizeCell);
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<unknown>, normalizeCell);
  if (value && typeof value === "object") {
    const row = typeof (value as { toJSON?: unknown }).toJSON === "function"
      ? (value as { toJSON(): unknown }).toJSON() : value;
    if (Array.isArray(row)) return row.map(normalizeCell);
    return Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, cell]) => [key, normalizeCell(cell)]));
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
 * Resolve either a synchronous Buffer or a thenable (the real `@curatelabs/graphforge`
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
