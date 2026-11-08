import { randomUUID } from "node:crypto";
import type { QueryResult, TableRow } from "./types";

export const RESULT_PAGE_SIZE = 500;
export const RESULT_PAGE_BYTES = 4 * 1024 * 1024;

/** Plain, bounded public result. IPC and row-reader state never cross the UI/API boundary. */
export interface ResultPage {
  resultId: string;
  columns: string[];
  rows: TableRow[];
  rowCount: number;
  offset: number;
  nextOffset?: number;
  algorithm?: string;
  sourceQuery?: string;
  generationUuid?: string;
}

const identities = new WeakMap<QueryResult, string>();
export function resultIdentity(result: QueryResult): string {
  let identity = identities.get(result);
  if (!identity) identities.set(result, identity = randomUUID());
  return identity;
}

export function resultRow(result: QueryResult, index: number): TableRow | undefined {
  return Number.isSafeInteger(index) && index >= 0 && index < result.rowCount
    ? result.rows[index] : undefined;
}

/** Keep array iteration/indexing without allocating one JavaScript object per Arrow row.
 * Rows are immutable views of the original IPC, decoded only when requested.
 */
export function lazyResultRows(count: number, read: (index: number) => TableRow): TableRow[] {
  if (!Number.isSafeInteger(count) || count < 0 || count > 0xffff_ffff)
    throw new Error("RESULT_ROW_COUNT_INVALID: Use a query with a smaller result.");
  const indexOf = (key: string | symbol): number | undefined => {
    if (typeof key !== "string" || key === "") return undefined;
    const index = Number(key);
    return Number.isInteger(index) && index >= 0 && index < count && String(index) === key ? index : undefined;
  };
  return new Proxy(new Array<TableRow>(count), {
    get(target, key, receiver) {
      const index = indexOf(key);
      return index === undefined ? Reflect.get(target, key, receiver) : read(index);
    },
    has(target, key) { return indexOf(key) !== undefined || Reflect.has(target, key); },
    ownKeys() { return [...Array.from({ length: count }, (_, index) => String(index)), "length"]; },
    getOwnPropertyDescriptor(target, key) {
      const index = indexOf(key);
      return index === undefined ? Reflect.getOwnPropertyDescriptor(target, key)
        : { configurable: true, enumerable: true, writable: false, value: read(index) };
    },
    set() { throw new TypeError("Arrow result rows are immutable."); },
    defineProperty() { throw new TypeError("Arrow result rows are immutable."); },
    deleteProperty() { throw new TypeError("Arrow result rows are immutable."); },
    preventExtensions() { return false; },
  });
}

export function queryResultPage(result: QueryResult, offset = 0, limit = RESULT_PAGE_SIZE): ResultPage {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > result.rowCount ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > RESULT_PAGE_SIZE)
    throw new Error(`RESULT_PAGE_INVALID: Request an offset within the result and a limit from 1 to ${RESULT_PAGE_SIZE}.`);
  const page: ResultPage = {
    resultId: resultIdentity(result), columns: [...result.columns], rows: [], rowCount: result.rowCount, offset,
    ...(result.algorithm ? { algorithm: result.algorithm } : {}),
    ...(result.sourceQuery ? { sourceQuery: result.sourceQuery } : {}),
    ...(result.generationUuid ? { generationUuid: result.generationUuid } : {}),
  };
  // Reserve room for nextOffset and surrounding transport metadata.
  let bytes = Buffer.byteLength(JSON.stringify(page)) + 1024;
  if (bytes > RESULT_PAGE_BYTES)
    throw new Error("RESULT_PAGE_COLUMNS_TOO_LARGE: Use a smaller projection, or open a saved JSON or Arrow document.");
  for (let index = offset; index < Math.min(result.rowCount, offset + limit); index++) {
    const row = resultRow(result, index);
    if (!row) throw new Error("RESULT_ROW_MISSING: Run the query again to restore the complete result.");
    const json = JSON.stringify(row, (_key, value) => typeof value === "bigint" ? value.toString() : value);
    const size = Buffer.byteLength(json) + 1;
    if (bytes + size > RESULT_PAGE_BYTES) {
      if (!page.rows.length)
        throw new Error("RESULT_PAGE_ROW_TOO_LARGE: Use a smaller projection, or open a saved JSON or Arrow document.");
      break;
    }
    page.rows.push(JSON.parse(json));
    bytes += size;
  }
  if (offset + page.rows.length < result.rowCount) page.nextOffset = offset + page.rows.length;
  return page;
}
