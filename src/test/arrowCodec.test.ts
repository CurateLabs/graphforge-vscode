import * as assert from "node:assert/strict";
import {
  decodeTable,
  bufferToUuid,
  normalizeCell,
  resolveIpcBuffer,
  stringField,
} from "../session/arrowCodec";

import {
  Field, FixedSizeBinary, Float64, Int64, List, Struct, Table, Utf8,
  tableFromArrays, tableToIPC, vectorFromArray,
} from "apache-arrow";

suite("decodeTable", () => {
  test("normalizes nested structs, lists, UUIDs and large integers across sliced chunks", () => {
    const type = new Struct([
      new Field("id", new FixedSizeBinary(16)),
      new Field("count", new Int64()),
      new Field("properties", new Struct([
        new Field("score", new Float64()), new Field("label", new Utf8()),
      ])),
      new Field("values", new List(new Field("item", new Float64(), true))),
    ]);
    const entity = {
      id: Buffer.from("0123456789abcdef0123456789abcdef", "hex"),
      count: 9007199254740993n,
      properties: { score: 2.5, label: "nested" },
      values: [1, null, 3],
    };
    const table = new Table({ entity: vectorFromArray([entity, null, entity], type) });
    const sliced = table.concat(table).slice(1, 5);
    sliced.schema.metadata.set("graphforge.algorithm", "test");
    const ipc = Buffer.from(tableToIPC(sliced));
    const result = decodeTable(ipc);
    const normalized = {
      id: "01234567-89ab-cdef-0123-456789abcdef",
      count: "9007199254740993",
      properties: { score: 2.5, label: "nested" },
      values: [1, null, 3],
    };
    assert.deepEqual(result.rows, [
      { entity: null }, { entity: normalized }, { entity: normalized }, { entity: null },
    ]);
    assert.equal(result.ipc, ipc);
    assert.equal(result.algorithm, "test");
    assert.deepEqual(JSON.parse(JSON.stringify(result.rows)), result.rows);
    assert.equal(Object.getPrototypeOf(result.rows[1].entity), Object.prototype);
  });

  test("keeps scalar numeric columns and nulls unchanged", () => {
    const ipc = Buffer.from(tableToIPC(tableFromArrays({ value: [1, null, 3] })));
    const result = decodeTable(ipc);
    assert.deepEqual(result.rows, [{ value: 1 }, { value: null }, { value: 3 }]);
    assert.deepEqual(result.numericColumns, ["value"]);
  });
});

suite("bufferToUuid", () => {
  test("formats a 16-byte buffer as a hyphenated UUID", () => {
    const buf = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
    assert.equal(
      bufferToUuid(buf),
      "01234567-89ab-cdef-0123-456789abcdef",
    );
  });

  test("returns undefined for non-16-byte buffers", () => {
    assert.equal(bufferToUuid(Buffer.from("ab", "hex")), undefined);
  });
});

suite("normalizeCell", () => {
  test("passes through null/undefined", () => {
    assert.equal(normalizeCell(null), null);
    assert.equal(normalizeCell(undefined), undefined);
  });

  test("decodes a 16-byte buffer as a UUID", () => {
    const buf = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
    assert.equal(normalizeCell(buf), "01234567-89ab-cdef-0123-456789abcdef");
  });

  test("falls back to hex for non-UUID-length buffers", () => {
    const buf = Buffer.from("ab", "hex");
    assert.equal(normalizeCell(buf), "ab");
  });

  test("stringifies bigint", () => {
    assert.equal(normalizeCell(10n), "10");
  });

  test("leaves plain values untouched", () => {
    assert.equal(normalizeCell("hello"), "hello");
    assert.equal(normalizeCell(42), 42);
  });
});

suite("stringField", () => {
  test("stringifies present fields", () => {
    assert.equal(stringField({ claim: "x" }, "claim"), "x");
    assert.equal(stringField({ n: 42 }, "n"), "42");
  });

  test("returns undefined for missing/null fields", () => {
    assert.equal(stringField({}, "missing"), undefined);
    assert.equal(stringField({ n: null }, "n"), undefined);
  });
});

suite("resolveIpcBuffer", () => {
  test("resolves a plain Buffer synchronously", async () => {
    const buf = Buffer.from("abc");
    assert.equal(await resolveIpcBuffer(buf), buf);
  });

  test("awaits a Promise<Buffer>", async () => {
    const buf = Buffer.from("abc");
    assert.equal(await resolveIpcBuffer(Promise.resolve(buf)), buf);
  });

  test("awaits a thenable that is not a native Promise", async () => {
    const buf = Buffer.from("abc");
    const thenable = { then: (resolve: (v: Buffer) => void) => resolve(buf) };
    assert.equal(await resolveIpcBuffer(thenable), buf);
  });
});
