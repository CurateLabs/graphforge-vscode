import * as assert from "node:assert/strict";
import type { EntityInspectSelection } from "../webview/protocol";
import { serializeEntityMutation } from "../webview/entityMutation";

suite("Entity Inspect edit mutations", () => {
  test("serializes changed and removed node properties as rerunnable Cypher", () => {
    const selection: EntityInspectSelection = {
      kind: "node",
      item: {
        id: "ATL",
        labels: ["Airport"],
        properties: {
          city: "Atlanta",
          runways: 5,
          obsolete: true,
        },
      },
    };

    const mutation = serializeEntityMutation(selection, {
      city: "Austin",
      runways: 2,
      tags: ["hub", "sample"],
    });

    assert.deepEqual(mutation.setKeys, ["city", "runways", "tags"]);
    assert.deepEqual(mutation.removedKeys, ["obsolete"]);
    assert.match(
      mutation.cypher,
      /WHERE entity\.id = 'ATL'.*entity\.code = 'ATL'/,
    );
    assert.match(mutation.cypher, /entity\.`city` = 'Austin'/);
    assert.match(
      mutation.cypher,
      /entity\.`tags` = \['hub', 'sample'\]/,
    );
    assert.match(mutation.cypher, /REMOVE entity\.`obsolete`/);
    assert.match(mutation.cypher, /RETURN count\(entity\) AS updated/);
  });

  test("matches an edge by type and endpoint identities", () => {
    const mutation = serializeEntityMutation(
      {
        kind: "edge",
        item: {
          id: "ATL->AUS",
          type: "ROUTE",
          source: "ATL",
          target: "AUS",
          properties: { dist: 813 },
        },
      },
      { dist: 815 },
    );

    assert.match(
      mutation.cypher,
      /MATCH \(source\)-\[entity:`ROUTE`\]->\(target\)/,
    );
    assert.match(mutation.cypher, /source\.code = 'ATL'/);
    assert.match(mutation.cypher, /target\.code = 'AUS'/);
    assert.match(mutation.cypher, /entity\.`dist` = 815/);
  });

  test("rejects invalid JSON numbers and no-op saves", () => {
    const selection: EntityInspectSelection = {
      kind: "node",
      item: {
        id: "n1",
        labels: ["Node"],
        properties: { score: 1 },
      },
    };
    assert.throws(
      () => serializeEntityMutation(selection, { score: Number.NaN }),
      /finite JSON number/,
    );
    assert.throws(
      () => serializeEntityMutation(selection, { score: { nested: true } }),
      /nested objects are not valid graph properties/,
    );
    assert.throws(
      () => serializeEntityMutation(selection, { score: 1 }),
      /No property changes/,
    );
  });
});
