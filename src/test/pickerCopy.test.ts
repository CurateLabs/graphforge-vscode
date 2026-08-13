import * as assert from "node:assert/strict";
import {
  CONFIDENCE_POLICY_OPTIONS,
  DIFF_DETAIL_OPTIONS,
  DIFF_SCOPE_OPTIONS,
  EVIDENCE_ROLE_OPTIONS,
  EXPLICIT_STATUS_OPTIONS,
  GRAPH_KIND_OPTIONS,
  GlossedOption,
  SOURCE_KIND_OPTIONS,
  WRITE_MODE_OPTIONS,
} from "../commands/pickerCopy";
import { WRITE_MODES } from "../session/types";

/**
 * Pins the plain-language QuickPick glosses (#40): every raw-enum picker
 * option must carry a one-line workbench-voice `detail`, and the option
 * lists must stay in lockstep with the engine enums they present. Removing
 * a token or shipping a bare/blank gloss fails here, not in a user's palette.
 */

const ALL_OPTION_LISTS: Array<[string, readonly GlossedOption[]]> = [
  ["DIFF_SCOPE_OPTIONS", DIFF_SCOPE_OPTIONS],
  ["DIFF_DETAIL_OPTIONS", DIFF_DETAIL_OPTIONS],
  ["WRITE_MODE_OPTIONS", WRITE_MODE_OPTIONS],
  ["GRAPH_KIND_OPTIONS", GRAPH_KIND_OPTIONS],
  ["SOURCE_KIND_OPTIONS", SOURCE_KIND_OPTIONS],
  ["EVIDENCE_ROLE_OPTIONS", EVIDENCE_ROLE_OPTIONS],
  ["CONFIDENCE_POLICY_OPTIONS", CONFIDENCE_POLICY_OPTIONS],
  ["EXPLICIT_STATUS_OPTIONS", EXPLICIT_STATUS_OPTIONS],
];

suite("pickerCopy — glossed QuickPick options (#40)", () => {
  test("every option has a non-empty, one-line, plain-language detail", () => {
    for (const [name, options] of ALL_OPTION_LISTS) {
      assert.ok(options.length > 0, `${name} must not be empty`);
      for (const option of options) {
        assert.ok(option.detail.trim().length > 0, `${name}.${option.label}: detail required`);
        assert.ok(!option.detail.includes("\n"), `${name}.${option.label}: detail must be one line`);
        assert.ok(
          option.detail.length <= 100,
          `${name}.${option.label}: detail too long for a picker line`,
        );
        assert.notEqual(
          option.detail.trim().toLowerCase(),
          option.label.toLowerCase(),
          `${name}.${option.label}: detail must gloss the token, not repeat it`,
        );
        assert.ok(
          !/\w_\w/.test(option.detail),
          `${name}.${option.label}: detail leaks a snake_case engine token`,
        );
      }
    }
  });

  test("labels are unique within each list", () => {
    for (const [name, options] of ALL_OPTION_LISTS) {
      const labels = options.map((o) => o.label);
      assert.equal(new Set(labels).size, labels.length, `${name}: duplicate labels`);
    }
  });

  test("write-mode options cover WRITE_MODES exactly, in order", () => {
    assert.deepEqual(
      WRITE_MODE_OPTIONS.map((o) => o.label),
      [...WRITE_MODES],
    );
  });

  test("option lists cover the engine enums they present", () => {
    assert.deepEqual(GRAPH_KIND_OPTIONS.map((o) => o.label), ["node", "edge"]);
    assert.deepEqual(SOURCE_KIND_OPTIONS.map((o) => o.label), [
      "document",
      "observation",
      "graph_node",
      "graph_edge",
    ]);
    assert.deepEqual(EVIDENCE_ROLE_OPTIONS.map((o) => o.label), [
      "supports",
      "contradicts",
      "context",
    ]);
    assert.deepEqual(CONFIDENCE_POLICY_OPTIONS.map((o) => o.label), [
      "explicit",
      "conservative_min",
    ]);
    assert.deepEqual(EXPLICIT_STATUS_OPTIONS.map((o) => o.label), [
      "hypothesis",
      "supported",
      "refuted",
      "disputed",
      "retracted",
      "superseded",
    ]);
    assert.deepEqual(DIFF_SCOPE_OPTIONS.map((o) => o.label), [
      "summary",
      "graph",
      "ontology",
      "configuration",
      "capabilities",
      "provenance",
      "knowledge",
      "epistemic",
      "all",
    ]);
    assert.deepEqual(DIFF_DETAIL_OPTIONS.map((o) => o.label), ["summary", "records"]);
  });
});
