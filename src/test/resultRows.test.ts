import * as assert from "node:assert/strict";
import { lazyResultRows, queryResultPage, resultIdentity, RESULT_PAGE_BYTES } from "../session/resultRows";
import type { QueryResult } from "../session/types";

suite("bounded Arrow-backed result access", () => {
  test("constructs without reading rows; paging reads only the requested window", () => {
    const reads: number[] = [];
    const rows = lazyResultRows(1203, index => { reads.push(index); return { value: BigInt(index) }; });
    const result: QueryResult = { columns: ["value"], rows, rowCount: rows.length };
    assert.deepEqual(reads, []);
    const page = queryResultPage(result, 1000);
    assert.equal(page.rows.length, 203);
    assert.deepEqual(reads, Array.from({ length: 203 }, (_, index) => index + 1000));
    assert.deepEqual(page.rows[0], { value: "1000" });
    assert.equal(page.nextOffset, undefined);
    assert.equal(page.resultId, resultIdentity(result));
    assert.notEqual(resultIdentity({ ...result }), page.resultId);
    assert.equal(page.rowCount, 1203);
    assert.ok(!("ipc" in page));
  });

  test("keeps normal array reads while rejecting mutation and preserving source values", () => {
    const rows = lazyResultRows(3, value => ({ value }));
    assert.deepEqual(rows.map(row => row.value), [0, 1, 2]);
    assert.deepEqual(rows.slice(1), [{ value: 1 }, { value: 2 }]);
    assert.deepEqual(Object.keys(rows), ["0", "1", "2"]);
    assert.throws(() => { rows[0] = { value: 9 }; }, /immutable/);
    assert.throws(() => { rows.length = 0; }, /immutable/);
    assert.throws(() => { Object.defineProperty(rows, "0", { value: {} }); }, /immutable/);
    rows[0].value = 9;
    assert.equal(rows[0].value, 0);
  });

  test("shortens a page by encoded bytes and resumes at the exact next row", () => {
    const result: QueryResult = { columns: ["text"], rows: Array.from({ length: 8 }, (_, index) => ({ text: "é".repeat(400_000), index })), rowCount: 8 };
    const first = queryResultPage(result);
    assert.ok(first.rows.length > 0 && first.rows.length < 8);
    assert.ok(Buffer.byteLength(JSON.stringify(first)) < RESULT_PAGE_BYTES);
    assert.equal(first.nextOffset, first.rows.length);
    const second = queryResultPage(result, first.nextOffset);
    assert.equal(second.rows[0].index, first.rows.length);
    assert.equal(first.resultId, second.resultId);
  });

  test("rejects an oversized row or columns and invalid ranges without truncation", () => {
    const result: QueryResult = { columns: ["text"], rows: [{ text: "x".repeat(RESULT_PAGE_BYTES) }], rowCount: 1 };
    assert.throws(() => queryResultPage(result), /RESULT_PAGE_ROW_TOO_LARGE.*saved JSON or Arrow/);
    assert.throws(() => queryResultPage({ ...result, columns: ["x".repeat(RESULT_PAGE_BYTES)] }), /RESULT_PAGE_COLUMNS_TOO_LARGE/);
    for (const offset of [-1, 2, 0.5, NaN]) assert.throws(() => queryResultPage(result, offset), /RESULT_PAGE_INVALID/);
    for (const limit of [0, 501, 0.5, NaN]) assert.throws(() => queryResultPage(result, 0, limit), /RESULT_PAGE_INVALID/);
    assert.deepEqual(queryResultPage({ columns: [], rows: [], rowCount: 0 }).rows, []);
  });
});
