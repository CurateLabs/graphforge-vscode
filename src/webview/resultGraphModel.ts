import type { GraphEdge, GraphNode, GraphPayload } from "../session/types";
import {
  CLASS_COLOR_PALETTE,
  EPISTEMIC_COLORS,
  type EntityInspectSelection,
  type WebviewToHost,
} from "./protocol";

export type ResultGraphRenderer = "g6" | "cytoscape" | "sigma";

export type ResultGraphBackend = "canvas" | "webgl";

export type ResultGraphOptionSource = "legacy" | "artifact-v2";

export interface ResultGraphVisualDensityOptions {
  nodeSize?: number;
  edgeWidth?: number;
  showNodeLabels?: boolean;
  showEdgeLabels?: boolean;
  arrowheads?: boolean;
}

export interface ResultGraphLabelOptions {
  nodeFields: string[];
  nodeFallback: "label-or-id" | "id";
  edgeField: "type" | null;
}

export interface EnabledResultGraphTimebarOptions {
  enabled: true;
  nodeField: string | null;
  edgeField: string | null;
  format: "epoch-ms" | "iso-8601";
  elementTypes: ("node" | "edge")[];
  values: [number, number];
  position: "top" | "bottom";
  width: number;
  height: number;
  loop: boolean;
}

export type ResultGraphTimebarOptions =
  | { enabled: false }
  | EnabledResultGraphTimebarOptions;

export interface ResultGraphLayoutOptions {
  type?: "force-atlas2";
  execution?: "worker";
  animation?: false;
  maxIteration?: number;
  maxIterations?: number;
  iterations?: number;
  barnesHut?: boolean;
  prune?: boolean;
  preventOverlap?: boolean;
  dissuadeHubs?: boolean;
  nodeSize?: number;
  nodeSpacing?: number;
  kr?: number;
  kg?: number;
  ks?: number;
  ksmax?: number;
  tao?: number;
  mode?: "normal" | "linlog";
  nodeRepulsion?: number;
  idealEdgeLength?: number;
  gravity?: number;
  slowDown?: number;
  barnesHutOptimize?: boolean;
}

export interface ResultGraphViewOptions {
  renderer?: ResultGraphRenderer;
  backend?: ResultGraphBackend;
  source?: ResultGraphOptionSource;
  layout?: ResultGraphLayoutOptions;
  visualDensity?: ResultGraphVisualDensityOptions;
  labels?: ResultGraphLabelOptions;
  timebar?: ResultGraphTimebarOptions;
}

export interface ResolvedResultGraphCytoscapeOptions {
  backend: "canvas";
  layout: {
    maxIterations: number;
    gravity: number;
    nodeRepulsion: number;
    idealEdgeLength: number;
  };
  visualDensity: Required<ResultGraphVisualDensityOptions>;
}

export interface ResolvedResultGraphSigmaOptions {
  backend: "webgl";
  layout: {
    iterations: number;
    gravity: number;
    slowDown: number;
    barnesHutOptimize: boolean;
  };
  visualDensity: Required<ResultGraphVisualDensityOptions>;
}

export interface ResolvedResultGraphG6Options {
  backend: ResultGraphBackend;
  layout: Required<
    Pick<
      ResultGraphLayoutOptions,
      | "type"
      | "execution"
      | "animation"
      | "maxIteration"
      | "barnesHut"
      | "prune"
      | "preventOverlap"
      | "dissuadeHubs"
      | "nodeSize"
      | "nodeSpacing"
      | "kr"
      | "kg"
      | "ks"
      | "ksmax"
      | "tao"
      | "mode"
    >
  >;
  visualDensity: Required<ResultGraphVisualDensityOptions>;
  timebar?: EnabledResultGraphTimebarOptions;
}

/**
 * The complete G6 compatibility defaults. In particular, every ForceAtlas2
 * option that AntV otherwise changes at graph-size thresholds is explicit.
 * Project artifacts can materialize these values without depending on the
 * installed AntV version's internal heuristics.
 */
export const DEFAULT_RESULT_GRAPH_G6_OPTIONS: Readonly<
  Omit<ResolvedResultGraphG6Options, "timebar">
> = {
  backend: "canvas",
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

export type GraphSelection = EntityInspectSelection & {
  /** Open this selection in an additional inspect tab instead of the reusable tab. */
  openInNewTab?: boolean;
};

export function normalizeResultGraphRenderer(value: unknown): ResultGraphRenderer {
  if (value === "cytoscape" || value === "sigma") {
    return value;
  }
  return "g6";
}

function defined<T extends object>(value: T | undefined): Partial<T> {
  return Object.fromEntries(
    Object.entries(value ?? {}).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

export function resolveResultGraphG6Options(
  options: ResultGraphViewOptions,
): ResolvedResultGraphG6Options {
  const layout = options.layout ?? {};
  if (options.source === "artifact-v2") {
    if (options.backend !== "canvas") {
      throw new Error("Saved v2 G6 Result Graph requires the canvas backend.");
    }
    if (layout.type !== "force-atlas2" || layout.execution !== "worker" || layout.animation !== false) {
      throw new Error("Saved v2 G6 Result Graph requires an explicit worker ForceAtlas2 layout with animation disabled.");
    }
    if (layout.mode !== "normal" && layout.mode !== "linlog") {
      throw new Error("Saved v2 G6 Result Graph is missing graph.layout.mode.");
    }
    return {
      backend: "canvas",
      layout: {
        type: layout.type,
        execution: layout.execution,
        animation: layout.animation,
        maxIteration: requireArtifactNumber(layout.maxIteration, "graph.layout.maxIteration"),
        barnesHut: requireArtifactBoolean(layout.barnesHut, "graph.layout.barnesHut"),
        prune: requireArtifactBoolean(layout.prune, "graph.layout.prune"),
        preventOverlap: requireArtifactBoolean(layout.preventOverlap, "graph.layout.preventOverlap"),
        dissuadeHubs: requireArtifactBoolean(layout.dissuadeHubs, "graph.layout.dissuadeHubs"),
        nodeSize: requireArtifactNumber(layout.nodeSize, "graph.layout.nodeSize"),
        nodeSpacing: requireArtifactNumber(layout.nodeSpacing, "graph.layout.nodeSpacing"),
        kr: requireArtifactNumber(layout.kr, "graph.layout.kr"),
        kg: requireArtifactNumber(layout.kg, "graph.layout.kg"),
        ks: requireArtifactNumber(layout.ks, "graph.layout.ks"),
        ksmax: requireArtifactNumber(layout.ksmax, "graph.layout.ksmax"),
        tao: requireArtifactNumber(layout.tao, "graph.layout.tao"),
        mode: layout.mode,
      },
      visualDensity: requireArtifactVisualDensity(options),
      timebar: options.timebar?.enabled ? options.timebar : undefined,
    };
  }
  return {
    backend: options.backend ?? DEFAULT_RESULT_GRAPH_G6_OPTIONS.backend,
    layout: {
      ...DEFAULT_RESULT_GRAPH_G6_OPTIONS.layout,
      ...defined(options.layout),
    },
    visualDensity: {
      ...DEFAULT_RESULT_GRAPH_G6_OPTIONS.visualDensity,
      ...defined(options.visualDensity),
    },
    timebar: options.timebar?.enabled ? options.timebar : undefined,
  };
}

function requireArtifactNumber(
  value: number | undefined,
  field: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Saved v2 Result Graph is missing numeric ${field}.`);
  }
  return value;
}

function requireArtifactBoolean(
  value: boolean | undefined,
  field: string,
): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Saved v2 Result Graph is missing boolean ${field}.`);
  }
  return value;
}

function requireArtifactVisualDensity(
  options: ResultGraphViewOptions,
): Required<ResultGraphVisualDensityOptions> {
  const density = options.visualDensity ?? {};
  return {
    nodeSize: requireArtifactNumber(density.nodeSize, "graph.style.nodeSize"),
    edgeWidth: requireArtifactNumber(density.edgeWidth, "graph.style.edgeWidth"),
    showNodeLabels: requireArtifactBoolean(
      density.showNodeLabels,
      "graph.style.showNodeLabels",
    ),
    showEdgeLabels: requireArtifactBoolean(
      density.showEdgeLabels,
      "graph.style.showEdgeLabels",
    ),
    arrowheads: requireArtifactBoolean(
      density.arrowheads,
      "graph.style.arrowheads",
    ),
  };
}

/**
 * Resolve Cytoscape options at the renderer boundary. Saved v2 artifacts take
 * a strict, size-independent path; direct and v1 views retain their adaptive
 * compatibility defaults.
 */
export function resolveResultGraphCytoscapeOptions(
  options: ResultGraphViewOptions,
  nodeCount: number,
  edgeCount: number,
): ResolvedResultGraphCytoscapeOptions {
  const artifact = options.source === "artifact-v2";
  if (artifact && options.backend !== "canvas") {
    throw new Error("Saved v2 Cytoscape Result Graph requires the canvas backend.");
  }
  const layout = options.layout ?? {};
  return {
    backend: "canvas",
    layout: {
      maxIterations: artifact
        ? requireArtifactNumber(layout.maxIterations, "graph.layout.maxIterations")
        : layout.maxIterations ?? (nodeCount > 400 ? 400 : 900),
      gravity: artifact
        ? requireArtifactNumber(layout.gravity, "graph.layout.gravity")
        : layout.gravity ?? 0.7,
      nodeRepulsion: artifact
        ? requireArtifactNumber(layout.nodeRepulsion, "graph.layout.nodeRepulsion")
        : layout.nodeRepulsion ?? (nodeCount > 400 ? 180_000 : 90_000),
      idealEdgeLength: artifact
        ? requireArtifactNumber(layout.idealEdgeLength, "graph.layout.idealEdgeLength")
        : layout.idealEdgeLength ?? (nodeCount > 400 ? 42 : 70),
    },
    visualDensity: artifact
      ? requireArtifactVisualDensity(options)
      : {
          nodeSize: options.visualDensity?.nodeSize ?? (nodeCount > 400 ? 12 : 22),
          edgeWidth: options.visualDensity?.edgeWidth ?? (edgeCount > 2_000 ? 0.55 : 1.3),
          showNodeLabels: options.visualDensity?.showNodeLabels ?? true,
          showEdgeLabels: options.visualDensity?.showEdgeLabels ?? edgeCount <= 350,
          arrowheads: options.visualDensity?.arrowheads ?? edgeCount <= 2_000,
        },
  };
}

/** Sigma equivalent of `resolveResultGraphCytoscapeOptions`. */
export function resolveResultGraphSigmaOptions(
  options: ResultGraphViewOptions,
  nodeCount: number,
  edgeCount: number,
): ResolvedResultGraphSigmaOptions {
  const artifact = options.source === "artifact-v2";
  if (artifact && options.backend !== "webgl") {
    throw new Error("Saved v2 Sigma Result Graph requires the webgl backend.");
  }
  const layout = options.layout ?? {};
  return {
    backend: "webgl",
    layout: {
      iterations: artifact
        ? requireArtifactNumber(layout.iterations, "graph.layout.iterations")
        : layout.iterations ?? (nodeCount > 400 ? 45 : 90),
      gravity: artifact
        ? requireArtifactNumber(layout.gravity, "graph.layout.gravity")
        : layout.gravity ?? 1,
      slowDown: artifact
        ? requireArtifactNumber(layout.slowDown, "graph.layout.slowDown")
        : layout.slowDown ?? (nodeCount > 400 ? 8 : 3),
      barnesHutOptimize: artifact
        ? requireArtifactBoolean(
            layout.barnesHutOptimize,
            "graph.layout.barnesHutOptimize",
          )
        : layout.barnesHutOptimize ?? nodeCount > 200,
    },
    visualDensity: artifact
      ? requireArtifactVisualDensity(options)
      : {
          nodeSize: options.visualDensity?.nodeSize ?? (nodeCount > 400 ? 2.5 : 5),
          edgeWidth: options.visualDensity?.edgeWidth ?? (edgeCount > 2_000 ? 0.35 : 1),
          showNodeLabels: options.visualDensity?.showNodeLabels ?? true,
          showEdgeLabels: options.visualDensity?.showEdgeLabels ?? edgeCount <= 350,
          // The legacy Sigma adapter never rendered arrowheads.
          arrowheads: options.visualDensity?.arrowheads ?? false,
        },
  };
}

export function classOf(node: GraphNode): string {
  return node.ontologyType || node.labels[0] || "Node";
}

export function classColor(name: string): string {
  const key = name || "(none)";
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return CLASS_COLOR_PALETTE[hash % CLASS_COLOR_PALETTE.length];
}

export function graphItemColor(
  item: GraphNode | GraphEdge,
  payload: Pick<GraphPayload, "styleMode">,
): string {
  if (payload.styleMode === "epistemic" || payload.styleMode === "demo") {
    return EPISTEMIC_COLORS[item.epistemicStatus ?? "statusless"];
  }
  return "labels" in item ? classColor(classOf(item)) : "#7f8c9a";
}

export function nodeLabel(
  node: GraphNode,
  labels?: ResultGraphLabelOptions,
): string {
  if (labels) {
    for (const field of labels.nodeFields) {
      const candidate = node.properties[field];
      if (typeof candidate === "string" || typeof candidate === "number") {
        return String(candidate);
      }
    }
    if (labels.nodeFallback === "label-or-id") {
      return node.labels[0] || node.id;
    }
    return node.id;
  }
  const preferred = node.properties.name ?? node.properties.label;
  if (typeof preferred === "string" || typeof preferred === "number") {
    return String(preferred);
  }
  return node.labels[0] || node.id.slice(0, 8);
}

export function edgeLabel(
  edge: GraphEdge,
  labels?: ResultGraphLabelOptions,
): string {
  if (!labels) {
    return edge.type;
  }
  return labels.edgeField === "type" ? edge.type : "";
}

/**
 * Resolve only selection messages against the current payload. Unknown or
 * stale ids are ignored, keeping the webview boundary fail-closed.
 */
export function resolveGraphSelection(
  payload: GraphPayload | undefined,
  message: WebviewToHost,
): GraphSelection | undefined {
  if (!payload) {
    return undefined;
  }
  if (message.type === "graphforge/selectNode") {
    const item = payload.nodes.find((node) => node.id === message.id);
    return item
      ? { kind: "node", item, openInNewTab: message.shiftKey === true }
      : undefined;
  }
  if (message.type === "graphforge/selectEdge") {
    const item = payload.edges.find((edge) => edge.id === message.id);
    return item
      ? { kind: "edge", item, openInNewTab: message.shiftKey === true }
      : undefined;
  }
  return undefined;
}
