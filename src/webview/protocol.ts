import type {
  EpistemicStatus,
  GraphPayload,
  OntologyDoc,
  OntologyMode,
} from "../session/types";

export type HostToWebview =
  | { type: "graphforge/graph"; payload: GraphPayload }
  | {
      type: "graphforge/ontology";
      mode: OntologyMode;
      ontology?: OntologyDoc;
      projectName?: string;
    }
  | { type: "graphforge/status"; message: string };

export type WebviewToHost =
  | { type: "graphforge/ready" }
  | { type: "graphforge/selectNode"; id: string }
  | { type: "graphforge/selectEdge"; id: string }
  | { type: "graphforge/requestReload" }
  | { type: "graphforge/explainMode" }
  | { type: "graphforge/openOntologyFile" };

/** Extension-owned palette (product has no official colors). */
export const EPISTEMIC_COLORS: Record<EpistemicStatus, string> = {
  supported: "#2f9e44",
  hypothesis: "#f59f00",
  disputed: "#e67700",
  refuted: "#e03131",
  retracted: "#c92a2a",
  superseded: "#868e96",
  statusless: "#495057",
};

/**
 * Extension-owned class palette for "class-only" styling (no knowledge
 * capability, or binding predates belief/status APIs). Deterministically
 * hashed onto by ontology/label class name — see `classColor` in the
 * webview script.
 */
export const CLASS_COLOR_PALETTE: readonly string[] = [
  "#4c6ef5",
  "#12b886",
  "#fab005",
  "#7048e8",
  "#e64980",
  "#15aabf",
  "#82c91e",
  "#fa5252",
  "#fd7e14",
  "#20c997",
];
