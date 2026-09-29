import { DataType, tableFromIPC, Type, type Field, type Table } from "apache-arrow";
import type {
  QueryResult,
  ResultField,
  ResultFieldType,
  ResultSchema,
  TableRow,
} from "./types";

/** Bounds on engine-supplied schema metadata before it reaches projection or disk. */
export const MAX_SCHEMA_METADATA_ENTRIES = 64;
export const MAX_SCHEMA_METADATA_VALUE_LENGTH = 1024;
export const MAX_SCHEMA_DEPTH = 8;

/**
 * Decode an Arrow IPC buffer (as returned by every `@curatelabs/graphforge` read call)
 * into rows plus a typed schema. Pure / no vscode dependency so it is unit-testable
 * with a synthetic table standing in for engine output (e.g. an assertions page).
 *
 * Field types drive value normalization: `FixedSizeBinary(16)` becomes a
 * hyphenated UUID, UUID lists stay ordered string arrays, Cypher entity/path
 * structs become plain objects, and embedding vectors stay numeric arrays. The
 * schema (field kinds + `graphforge.*` metadata) is preserved so projection can
 * classify the result instead of guessing from column names.
 */
export function decodeTable(buf: Buffer): QueryResult {
  const table = tableFromIPC(buf) as Table;
  const fields = table.schema.fields;
  const columns = fields.map((f) => f.name);
  const children = fields.map((f) => table.getChild(f.name));
  const rows: TableRow[] = [];
  for (let i = 0; i < table.numRows; i++) {
    const row: TableRow = {};
    for (let c = 0; c < fields.length; c++) {
      row[columns[c]] = normalizeTypedCell(children[c]?.get(i), fields[c].type);
    }
    rows.push(row);
  }
  const schema = describeSchema(fields, table.schema.metadata);
  return {
    columns,
    rows,
    rowCount: table.numRows,
    algorithm: schema.metadata["graphforge.algorithm"],
    schema,
  };
}

/** Describe Arrow fields as the bounded, JSON-safe `ResultSchema` contract. */
export function describeSchema(
  fields: readonly Field[],
  metadata: Map<string, string> | undefined,
): ResultSchema {
  return {
    fields: fields.map((f) => describeField(f, 0)),
    metadata: boundedMetadata(metadata),
  };
}

function describeField(field: Field, depth: number): ResultField {
  const described: ResultField = {
    name: field.name,
    type: describeType(field.type, depth),
    nullable: field.nullable,
  };
  const metadata = boundedMetadata(field.metadata);
  if (Object.keys(metadata).length > 0) {
    described.metadata = metadata;
  }
  return described;
}

function describeType(type: DataType, depth: number): ResultFieldType {
  if (depth > MAX_SCHEMA_DEPTH) {
    return { kind: "other", arrowType: "nested" };
  }
  if (DataType.isFixedSizeBinary(type)) {
    return type.byteWidth === 16 ? { kind: "uuid" } : { kind: "binary" };
  }
  if (DataType.isList(type) || DataType.isFixedSizeList(type)) {
    const item = type.children[0]?.type;
    const dimensions = DataType.isFixedSizeList(type) ? type.listSize : undefined;
    if (item && DataType.isFixedSizeBinary(item) && item.byteWidth === 16) {
      return { kind: "uuid-list" };
    }
    if (item && DataType.isFloat(item)) {
      return dimensions === undefined
        ? { kind: "float-vector" }
        : { kind: "float-vector", dimensions };
    }
    return {
      kind: "list",
      item: item ? describeType(item, depth + 1) : { kind: "other", arrowType: "unknown" },
    };
  }
  if (DataType.isStruct(type)) {
    return {
      kind: "struct",
      fields: type.children.map((child) => describeField(child, depth + 1)),
    };
  }
  if (DataType.isUtf8(type) || DataType.isLargeUtf8(type)) return { kind: "utf8" };
  if (DataType.isBool(type)) return { kind: "bool" };
  if (DataType.isInt(type)) {
    return { kind: "int", bits: type.bitWidth, signed: type.isSigned };
  }
  if (DataType.isFloat(type)) return { kind: "float" };
  if (DataType.isTimestamp(type)) {
    return type.timezone
      ? { kind: "timestamp", timezone: type.timezone }
      : { kind: "timestamp" };
  }
  if (DataType.isDate(type)) return { kind: "date" };
  if (DataType.isBinary(type) || DataType.isLargeBinary(type)) return { kind: "binary" };
  return { kind: "other", arrowType: Type[type.typeId] ?? "unknown" };
}

function boundedMetadata(
  metadata: Map<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!metadata) return out;
  let count = 0;
  for (const [key, value] of metadata) {
    if (count >= MAX_SCHEMA_METADATA_ENTRIES) break;
    if (typeof key !== "string" || typeof value !== "string") continue;
    if (key.length > 256 || value.length > MAX_SCHEMA_METADATA_VALUE_LENGTH) continue;
    out[key] = value;
    count += 1;
  }
  return out;
}

/** Normalize an Arrow cell using its declared type (nested structs/lists included). */
export function normalizeTypedCell(value: unknown, type: DataType): unknown {
  if (value == null) {
    return value;
  }
  if (DataType.isStruct(type)) {
    const record = value as Record<string, unknown>;
    const out: TableRow = {};
    for (const child of type.children) {
      out[child.name] = normalizeTypedCell(record[child.name], child.type);
    }
    return out;
  }
  if (DataType.isList(type) || DataType.isFixedSizeList(type)) {
    const itemType = type.children[0]?.type;
    const vector = value as { length: number; get(i: number): unknown };
    const items: unknown[] = [];
    for (let i = 0; i < vector.length; i++) {
      const item = vector.get(i);
      items.push(itemType ? normalizeTypedCell(item, itemType) : normalizeCell(item));
    }
    return items;
  }
  return normalizeCell(value);
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
