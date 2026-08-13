import * as assert from "node:assert/strict";
import type { GraphPayload } from "../session/types";
import {
  DEFAULT_RESULT_GRAPH_G6_OPTIONS,
  classColor,
  edgeLabel,
  graphItemColor,
  nodeLabel,
  normalizeResultGraphRenderer,
  resolveResultGraphCytoscapeOptions,
  resolveResultGraphG6Options,
  resolveResultGraphSigmaOptions,
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

  test("normalizes renderer setting with Cytoscape as the creation default", () => {
    assert.equal(normalizeResultGraphRenderer("g6"), "g6");
    assert.equal(normalizeResultGraphRenderer("sigma"), "sigma");
    assert.equal(normalizeResultGraphRenderer("cytoscape"), "cytoscape");
    assert.equal(normalizeResultGraphRenderer("unknown"), "cytoscape");
    assert.equal(normalizeResultGraphRenderer(undefined), "cytoscape");
  });

  test("materializes explicit G6 Canvas and ForceAtlas2 worker options", () => {
    const defaults = resolveResultGraphG6Options({ renderer: "g6" });
    assert.deepEqual(defaults.layout, DEFAULT_RESULT_GRAPH_G6_OPTIONS.layout);
    assert.deepEqual(
      defaults.visualDensity,
      DEFAULT_RESULT_GRAPH_G6_OPTIONS.visualDensity,
    );
    assert.equal(defaults.backend, "canvas");
    assert.equal(defaults.layout.type, "force-atlas2");
    assert.equal(defaults.layout.execution, "worker");
    assert.equal(defaults.layout.animation, false);
    assert.equal(defaults.layout.barnesHut, true);
    assert.equal(defaults.layout.prune, true);
    assert.equal(defaults.layout.maxIteration, 300);
  });

  test("preserves explicit G6 layout and visual-density settings", () => {
    const resolved = resolveResultGraphG6Options({
      renderer: "g6",
      layout: {
        maxIteration: 750,
        barnesHut: false,
        prune: false,
        kr: 8,
      },
      visualDensity: {
        nodeSize: 16,
        showNodeLabels: false,
        showEdgeLabels: true,
      },
    });
    assert.equal(resolved.layout.maxIteration, 750);
    assert.equal(resolved.layout.barnesHut, false);
    assert.equal(resolved.layout.prune, false);
    assert.equal(resolved.layout.kr, 8);
    assert.equal(resolved.visualDensity.nodeSize, 16);
    assert.equal(resolved.visualDensity.showNodeLabels, false);
    assert.equal(resolved.visualDensity.showEdgeLabels, true);
  });

  test("fails closed when a saved v2 G6 artifact omits explicit options", () => {
    assert.throws(
      () => resolveResultGraphG6Options({
        renderer: "g6",
        backend: "canvas",
        source: "artifact-v2",
        layout: { type: "force-atlas2", execution: "worker", animation: false },
        visualDensity: {
          nodeSize: 22,
          edgeWidth: 1,
          showNodeLabels: true,
          showEdgeLabels: false,
          arrowheads: true,
        },
      }),
      /graph\.layout\.mode|graph\.layout\.maxIteration/,
    );
  });

  test("does not let undefined legacy overrides erase G6 defaults", () => {
    const resolved = resolveResultGraphG6Options({
      renderer: "g6",
      layout: { maxIteration: undefined },
      visualDensity: { nodeSize: undefined },
    });
    assert.equal(resolved.layout.maxIteration, DEFAULT_RESULT_GRAPH_G6_OPTIONS.layout.maxIteration);
    assert.equal(resolved.visualDensity.nodeSize, DEFAULT_RESULT_GRAPH_G6_OPTIONS.visualDensity.nodeSize);
  });

  test("keeps saved v2 Cytoscape options exact at every graph size", () => {
    const options = {
      source: "artifact-v2" as const,
      backend: "canvas" as const,
      layout: {
        maxIterations: 123,
        gravity: 0.42,
        nodeRepulsion: 12_345,
        idealEdgeLength: 87,
      },
      visualDensity: {
        nodeSize: 17,
        edgeWidth: 2.25,
        showNodeLabels: false,
        showEdgeLabels: true,
        arrowheads: false,
      },
    };
    const small = resolveResultGraphCytoscapeOptions(options, 10, 12);
    const large = resolveResultGraphCytoscapeOptions(options, 10_000, 30_000);
    assert.deepEqual(large, small);
    assert.deepEqual(small.layout, {
      maxIterations: 123,
      gravity: 0.42,
      nodeRepulsion: 12_345,
      idealEdgeLength: 87,
    });
    assert.deepEqual(small.visualDensity, options.visualDensity);
  });

  test("keeps saved v2 Sigma options exact at every graph size", () => {
    const options = {
      source: "artifact-v2" as const,
      backend: "webgl" as const,
      layout: {
        iterations: 77,
        gravity: 0.8,
        slowDown: 4,
        barnesHutOptimize: false,
      },
      visualDensity: {
        nodeSize: 7,
        edgeWidth: 0.8,
        showNodeLabels: true,
        showEdgeLabels: false,
        arrowheads: true,
      },
    };
    const small = resolveResultGraphSigmaOptions(options, 10, 12);
    const large = resolveResultGraphSigmaOptions(options, 10_000, 30_000);
    assert.deepEqual(large, small);
    assert.deepEqual(small.layout, {
      iterations: 77,
      gravity: 0.8,
      slowDown: 4,
      barnesHutOptimize: false,
    });
    assert.deepEqual(small.visualDensity, options.visualDensity);
  });

  test("retains adaptive thresholds only for legacy and direct views", () => {
    const cytoscapeSmall = resolveResultGraphCytoscapeOptions({}, 10, 12);
    const cytoscapeLarge = resolveResultGraphCytoscapeOptions({}, 10_000, 30_000);
    assert.notDeepEqual(cytoscapeLarge, cytoscapeSmall);
    assert.equal(cytoscapeSmall.layout.maxIterations, 900);
    assert.equal(cytoscapeLarge.layout.maxIterations, 400);

    const sigmaSmall = resolveResultGraphSigmaOptions({}, 10, 12);
    const sigmaLarge = resolveResultGraphSigmaOptions({}, 10_000, 30_000);
    assert.notDeepEqual(sigmaLarge, sigmaSmall);
    assert.equal(sigmaSmall.layout.iterations, 90);
    assert.equal(sigmaLarge.layout.iterations, 45);
  });

  test("fails closed when a saved v2 renderer option is incomplete", () => {
    assert.throws(
      () => resolveResultGraphCytoscapeOptions({
        source: "artifact-v2",
        backend: "canvas",
      }, 10, 10),
      /graph\.layout\.maxIterations/,
    );
    assert.throws(
      () => resolveResultGraphSigmaOptions({
        source: "artifact-v2",
        backend: "webgl",
      }, 10, 10),
      /graph\.layout\.iterations/,
    );
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

  test("uses the persisted label field and fallback policy exactly", () => {
    const labels = {
      nodeFields: ["claim"],
      nodeFallback: "id" as const,
      edgeField: null,
    };
    assert.equal(nodeLabel(payload.nodes[1], labels), "A route exists");
    assert.equal(nodeLabel(payload.nodes[0], labels), "node-1");
    assert.equal(edgeLabel(payload.edges[0], labels), "");
    assert.equal(
      edgeLabel(payload.edges[0], { ...labels, edgeField: "type" }),
      "SUPPORTS",
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
