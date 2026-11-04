import type { GraphNode } from "../session/types";
import type { EntityInspectSelection } from "./protocol";
export type GraphSelection = EntityInspectSelection & {
  openInNewTab?: boolean;
};
export function nodeLabel(node: GraphNode): string {
  for (const key of ["name", "title", "label", "code"]) {
    const value = node.properties[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  // A class is a badge, not an entity's identity.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(node.id)
    ? node.id.slice(0, 8)
    : node.id;
}
