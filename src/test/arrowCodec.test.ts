import * as assert from "node:assert/strict";
import {
  bufferToUuid,
  normalizeCell,
  resolveIpcBuffer,
  stringField,
} from "../session/arrowCodec";

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
