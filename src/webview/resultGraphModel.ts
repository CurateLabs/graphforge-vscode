import type { GraphEdge, GraphNode, GraphPayload } from "../session/types";
import {
  CLASS_COLOR_PALETTE,
  EPISTEMIC_COLORS,
  type EntityInspectSelection,
  type WebviewToHost,
} from "./protocol";

export type ResultGraphRenderer = "cytoscape" | "sigma";

export interface ResultGraphLayoutOptions {
  nodeRepulsion?: number;
  idealEdgeLength?: number;
  gravity?: number;
  slowDown?: number;
}

export interface ResultGraphViewOptions {
  renderer?: ResultGraphRenderer;
  layout?: ResultGraphLayoutOptions;
}

export type GraphSelection = EntityInspectSelection & {
  /** Open this selection in an additional inspect tab instead of the reusable tab. */
  openInNewTab?: boolean;
};

export function normalizeResultGraphRenderer(value: unknown): ResultGraphRenderer {
  return value === "sigma" ? "sigma" : "cytoscape";
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

export function nodeLabel(node: GraphNode): string {
  const preferred = node.properties.name ?? node.properties.label;
  if (typeof preferred === "string" || typeof preferred === "number") {
    return String(preferred);
  }
  return node.labels[0] || node.id.slice(0, 8);
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
