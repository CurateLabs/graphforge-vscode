import * as assert from "node:assert/strict";
import type { GraphPayload } from "../session/types";
import {
  classColor,
  graphItemColor,
  nodeLabel,
  normalizeResultGraphRenderer,
  resolveGraphSelection,
} from "../webview/resultGraphModel";
import {
  entityInspectTitle,
  resolveEntityInspectOpenAction,
} from "../webview/entityInspectModel";
import { scheduleInitialResultGraphLayout } from "../webview/resultGraphLayout";

const payload: GraphPayload = {
  nodes: [
    {
      id: "node-1",
      labels: ["Airport"],
      properties: { name: "Denver" },
      epistemicStatus: "supported",
    },
    {
      id: "00000000-0000-7000-8000-000000000001",
      labels: ["Assertion"],
      properties: { claim: "A route exists" },
    },
  ],
  edges: [
    {
      id: "edge-1",
      source: "node-1",
      target: "00000000-0000-7000-8000-000000000001",
      type: "SUPPORTS",
      epistemicStatus: "hypothesis",
    },
  ],
  legend: { statuses: ["supported", "hypothesis"], types: ["Airport", "Assertion"] },
  styleMode: "epistemic",
};

suite("Result Graph model (#65)", () => {
  test("invokes force layout after the renderer is bound", () => {
    let scheduled: (() => void) | undefined;
    let layoutRuns = 0;

    scheduleInitialResultGraphLayout(
      { relayout: () => layoutRuns += 1 },
      (callback) => {
        scheduled = callback;
      },
    );

    assert.equal(layoutRuns, 0, "layout should wait until the renderer is bound");
    assert.ok(scheduled, "initial layout should be scheduled");
    scheduled();
    assert.equal(layoutRuns, 1);
  });

  test("normalizes renderer setting with Cytoscape as fail-closed default", () => {
    assert.equal(normalizeResultGraphRenderer("sigma"), "sigma");
    assert.equal(normalizeResultGraphRenderer("cytoscape"), "cytoscape");
    assert.equal(normalizeResultGraphRenderer("unknown"), "cytoscape");
    assert.equal(normalizeResultGraphRenderer(undefined), "cytoscape");
  });

  test("keeps deterministic class and epistemic styling", () => {
    assert.equal(classColor("Airport"), classColor("Airport"));
    assert.equal(graphItemColor(payload.nodes[0], payload), "#2f9e44");
    assert.equal(nodeLabel(payload.nodes[0]), "Denver");

    const classOnly = { ...payload, styleMode: "class-only" as const };
    assert.equal(
      graphItemColor(classOnly.nodes[0], classOnly),
      classColor("Airport"),
    );
  });

  test("resolves node and edge inspect messages against current payload", () => {
    const node = resolveGraphSelection(payload, {
      type: "graphforge/selectNode",
      id: "00000000-0000-7000-8000-000000000001",
    });
    assert.equal(node?.kind, "node");
    assert.equal(node?.openInNewTab, false);

    const edge = resolveGraphSelection(payload, {
      type: "graphforge/selectEdge",
      id: "edge-1",
      shiftKey: true,
    });
    assert.equal(edge?.kind, "edge");
    assert.equal(edge?.openInNewTab, true);
  });

  test("reuses the primary inspect panel unless shift requests a tab", () => {
    assert.equal(
      resolveEntityInspectOpenAction(false, true),
      "create-primary",
      "the first selection always establishes the reusable panel",
    );
    assert.equal(
      resolveEntityInspectOpenAction(true, false),
      "update-primary",
    );
    assert.equal(resolveEntityInspectOpenAction(true, true), "create-tab");
    assert.equal(
      entityInspectTitle({ kind: "node", item: payload.nodes[0] }),
      "Inspect: Denver",
    );
    assert.equal(
      entityInspectTitle({ kind: "edge", item: payload.edges[0] }),
      "Inspect: SUPPORTS",
    );
  });

  test("ignores stale ids and non-selection messages", () => {
    assert.equal(
      resolveGraphSelection(payload, {
        type: "graphforge/selectNode",
        id: "missing",
      }),
      undefined,
    );
    assert.equal(
      resolveGraphSelection(payload, { type: "graphforge/ready" }),
      undefined,
    );
  });
});
