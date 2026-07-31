import * as assert from "node:assert/strict";
import {
  aggregateStatusCounts,
  STATUS_BREAKDOWN_ORDER,
  STATUS_TREE_DISPLAY,
  statusBreakdownEntries,
} from "../session/knowledgeStatus";
import type { EpistemicStatus } from "../session/types";

const ALL_STATUSES: EpistemicStatus[] = [
  "hypothesis",
  "supported",
  "refuted",
  "disputed",
  "retracted",
  "superseded",
  "statusless",
];

suite("aggregateStatusCounts", () => {
  test("counts every status in the epistemic model", () => {
    const fixture: Array<EpistemicStatus | undefined> = [
      ...ALL_STATUSES,
      "supported",
      "supported",
      "hypothesis",
    ];
    assert.deepEqual(aggregateStatusCounts(fixture), {
      hypothesis: 2,
      supported: 3,
      refuted: 1,
      disputed: 1,
      retracted: 1,
      superseded: 1,
      statusless: 1,
    });
  });

  test("excludes unresolved (undefined) entries instead of counting them as statusless", () => {
    const counts = aggregateStatusCounts([undefined, "statusless", undefined]);
    assert.deepEqual(counts, { statusless: 1 });
  });

  test("returns an empty object for an empty ledger", () => {
    assert.deepEqual(aggregateStatusCounts([]), {});
  });
});

suite("STATUS_TREE_DISPLAY", () => {
  test("names an icon for every epistemic status", () => {
    for (const status of ALL_STATUSES) {
      const display = STATUS_TREE_DISPLAY[status];
      assert.ok(display, `missing display for ${status}`);
      assert.ok(display.icon.length > 0, `empty icon for ${status}`);
    }
  });

  test("distinguishes explicit statuses from statusless by color", () => {
    assert.equal(STATUS_TREE_DISPLAY.statusless.themeColor, undefined);
    assert.ok(STATUS_TREE_DISPLAY.supported.themeColor);
    assert.ok(STATUS_TREE_DISPLAY.refuted.themeColor);
  });
});

suite("statusBreakdownEntries", () => {
  test("emits only non-zero counts in stable order, statusless last", () => {
    const entries = statusBreakdownEntries({
      statusless: 2,
      supported: 3,
      refuted: 1,
    });
    assert.deepEqual(entries, [
      { status: "supported", count: 3 },
      { status: "refuted", count: 1 },
      { status: "statusless", count: 2 },
    ]);
  });

  test("covers the full model in STATUS_BREAKDOWN_ORDER", () => {
    assert.deepEqual([...STATUS_BREAKDOWN_ORDER].sort(), [...ALL_STATUSES].sort());
  });
});
