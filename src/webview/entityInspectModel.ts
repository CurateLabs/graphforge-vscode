import type { EntityInspectSelection } from "./protocol";
import { nodeLabel } from "./resultGraphModel";

export type EntityInspectOpenAction =
  | "create-primary"
  | "update-primary"
  | "create-tab";

/** Pure host-state decision used by the inspect panel manager. */
export function resolveEntityInspectOpenAction(
  hasPrimaryPanel: boolean,
  openInNewTab: boolean,
): EntityInspectOpenAction {
  if (!hasPrimaryPanel) {
    return "create-primary";
  }
  return openInNewTab ? "create-tab" : "update-primary";
}

export function entityInspectTitle(selection: EntityInspectSelection): string {
  const subject =
    selection.kind === "node" ? nodeLabel(selection.item) : selection.item.type;
  return `Inspect: ${subject}`.slice(0, 80);
}
