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
