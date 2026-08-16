/**
 * Result Graph payload styling and renderer option resolution. Labels and
 * colors are computed once per node/edge before the payload is posted to the
 * webview, so they run 10k+ times for a large result graph.
 */
import type { Bench } from "tinybench";
import {
  classOf,
  edgeLabel,
  graphItemColor,
  nodeLabel,
  normalizeResultGraphRenderer,
  resolveGraphSelection,
  resolveResultGraphCytoscapeOptions,
  resolveResultGraphG6Options,
  resolveResultGraphSigmaOptions,
  type ResultGraphViewOptions,
} from "../webview/resultGraphModel";
import { graphPayload } from "./fixtures";

const ARTIFACT_G6_OPTIONS: ResultGraphViewOptions = {
  renderer: "g6",
  backend: "canvas",
  source: "artifact-v2",
  layout: {
    type: "force-atlas2",
    execution: "worker",
    animation: false,
    maxIteration: 300,
    barnesHut: true,
    prune: true,
    preventOverlap: true,
    dissuadeHubs: false,
    nodeSize: 22,
    nodeSpacing: 4,
    kr: 5,
    kg: 1,
    ks: 0.1,
    ksmax: 10,
    tao: 0.1,
    mode: "normal",
  },
  visualDensity: {
    nodeSize: 22,
    edgeWidth: 1.3,
    showNodeLabels: true,
    showEdgeLabels: false,
    arrowheads: true,
  },
};

export function registerResultGraphBenchmarks(bench: Bench): void {
  const payload = graphPayload(5_000, 10_000);
  const classOnly = { ...payload, styleMode: "class-only" as const };
  const labelOptions = {
    nodeFields: ["title", "name"],
    nodeFallback: "label-or-id" as const,
    edgeField: "type" as const,
  };
  const selectNode = {
    type: "graphforge/selectNode" as const,
    id: payload.nodes[4_100].id,
  };

  bench.add("resultGraphModel: node labels (5k nodes, default policy)", () => {
    for (const node of payload.nodes) {
      nodeLabel(node);
    }
  });

  bench.add("resultGraphModel: node labels (5k nodes, artifact fields)", () => {
    for (const node of payload.nodes) {
      nodeLabel(node, labelOptions);
    }
  });

  bench.add("resultGraphModel: edge labels (10k edges)", () => {
    for (const edge of payload.edges) {
      edgeLabel(edge, labelOptions);
    }
  });

  bench.add("resultGraphModel: epistemic colors (15k elements)", () => {
    for (const node of payload.nodes) {
      graphItemColor(node, payload);
    }
    for (const edge of payload.edges) {
      graphItemColor(edge, payload);
    }
  });

  bench.add("resultGraphModel: class colors (5k nodes)", () => {
    for (const node of payload.nodes) {
      graphItemColor(node, classOnly);
      classOf(node);
    }
  });

  bench.add("resultGraphModel: resolve selection message (5k nodes)", () => {
    resolveGraphSelection(payload, selectNode);
  });

  bench.add("resultGraphModel: resolve renderer options", () => {
    normalizeResultGraphRenderer("sigma");
    resolveResultGraphG6Options({ renderer: "g6" });
    resolveResultGraphG6Options(ARTIFACT_G6_OPTIONS);
    resolveResultGraphCytoscapeOptions({ renderer: "cytoscape" }, 5_000, 10_000);
    resolveResultGraphSigmaOptions({ renderer: "sigma" }, 5_000, 10_000);
  });
}
