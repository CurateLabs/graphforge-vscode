import type { GraphNode } from "../session/types";
import type { EntityInspectSelection } from "./protocol";
export type GraphSelection = EntityInspectSelection & {
  openInNewTab?: boolean;
};
export function nodeLabel(node: GraphNode): string {
  const label =
    node.properties.name ?? node.properties.label ?? node.properties.code;
  return typeof label === "string" || typeof label === "number"
    ? String(label)
    : node.labels[0] || node.id.slice(0, 8);
}
