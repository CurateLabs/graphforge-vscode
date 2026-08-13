import * as assert from "node:assert/strict";
import { randomOperationId, uuidv7 } from "../session/uuid";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

suite("uuidv7", () => {
  test("produces a well-formed UUID string", () => {
    assert.match(uuidv7(), UUID_RE);
  });

  test("sets version nibble to 7", () => {
    const id = uuidv7();
    assert.equal(id[14], "7");
  });

  test("sets variant bits to 10xx (8/9/a/b)", () => {
    const id = uuidv7();
    assert.match(id[19], /[89ab]/);
  });

  test("timestamp prefix is monotonic non-decreasing across calls", () => {
    // Only the 48-bit timestamp (first 12 hex chars, i.e. before the second
    // hyphen) is guaranteed ordered; random fill can make two same-millisecond
    // UUIDs sort either way overall, which is expected/acceptable per RFC 9562.
    const timestampOf = (id: string) => id.replace(/-/g, "").slice(0, 12);
    let prev = timestampOf(uuidv7());
    for (let i = 0; i < 50; i++) {
      const next = timestampOf(uuidv7());
      assert.ok(next >= prev, `expected ${next} >= ${prev}`);
      prev = next;
    }
  });

  test("does not repeat across many calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(uuidv7());
    }
    assert.equal(seen.size, 200);
  });
});

suite("randomOperationId", () => {
  test("produces a well-formed UUID string", () => {
    assert.match(randomOperationId(), UUID_RE);
  });
});
