import * as assert from "node:assert/strict";
import {
  buildNodeImportCypher,
  cypherIdentifier,
  inferImportFormat,
  parseImportRecords,
} from "../modules/firstParty/import/importData";

suite("import module", () => {
  test("parses quoted CSV including commas, quotes, and newlines", () => {
    const records = parseImportRecords(
      'name,note\r\n"Ada, A.","line 1\nline 2"\r\n"Grace","said ""hi"""\r\n',
      "csv",
    );
    assert.deepEqual(records, [
      { name: "Ada, A.", note: "line 1\nline 2" },
      { name: "Grace", note: 'said "hi"' },
    ]);
  });

  test("accepts arrays, records envelopes, JSON Lines, and NDJSON inference", () => {
    assert.deepEqual(parseImportRecords('[{"id":1}]', "json"), [{ id: 1 }]);
    assert.deepEqual(parseImportRecords('{"records":[{"id":2}]}', "json"), [
      { id: 2 },
    ]);
    assert.deepEqual(parseImportRecords('{"id":3}\n{"id":4}\n', "jsonl"), [
      { id: 3 },
      { id: 4 },
    ]);
    assert.equal(inferImportFormat("events.ndjson"), "jsonl");
  });

  test("builds escaped create and merge mutations", () => {
    assert.equal(cypherIdentifier("Odd`Label"), "`Odd``Label`");
    assert.match(buildNodeImportCypher("Person", "create"), /CREATE \(n:`Person`\)/);
    assert.match(
      buildNodeImportCypher("Person", "merge", "external_id"),
      /MERGE \(n:`Person` \{`external_id`: row\.`external_id`\}\)/,
    );
  });

  test("rejects duplicate CSV headers and prototype-shaped keys", () => {
    assert.throws(() => parseImportRecords("id,id\n1,2", "csv"), /unique/);
    assert.throws(
      () => parseImportRecords('{"constructor":"bad"}', "json"),
      /reserved property/,
    );
  });
});

