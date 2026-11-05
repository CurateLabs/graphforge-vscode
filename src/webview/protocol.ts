import type {
  GraphEdge,
  GraphNode,
  OntologyDoc,
  OntologyMode,
  QueryResult,
} from "../session/types";
import type { GetStartedState } from "../views/getStartedView";
import type { VisualizationMessageContext } from "./visualizationInstanceRegistry";

export type EntityInspectSelection =
  { kind: "node"; item: GraphNode } | { kind: "edge"; item: GraphEdge };

export interface ResultEntityLink {
  kind: EntityInspectSelection["kind"];
  id: string;
  label: string;
}

export type HostToWebview =
  | { type: "graphforge/entityInspect"; selection: EntityInspectSelection }
  | {
      type: "graphforge/results";
      title: string;
      result: QueryResult;
      persisted?: { jsonPath: string; markdownPath: string };
      entityLinks?: Record<string, ResultEntityLink[]>;
    }
  | {
      type: "graphforge/resultSelection";
      message: string;
      linked: boolean;
    }
  | { type: "graphforge/highlightResultRows"; rowIndices: number[] }
  | {
      type: "graphforge/entityEditState";
      state: "saving" | "saved" | "error";
      message: string;
      mutationPath?: string;
      applied?: boolean;
    }
  | {
      type: "graphforge/ontology";
      mode: OntologyMode;
      ontology?: OntologyDoc;
      projectName?: string;
    }
  | { type: "graphforge/getStarted"; state: GetStartedState }
  | {
      type: "graphforge/commandStatus";
      status: "success" | "error";
      message: string;
    }
  | { type: "graphforge/status"; message: string };

export type WebviewToHost = (
  | { type: "graphforge/ready" }
  | { type: "graphforge/selectResult"; rowIndex: number; column?: string }
  | {
      type: "graphforge/openResultEntity";
      rowIndex: number;
      kind: EntityInspectSelection["kind"];
      id: string;
      shiftKey?: boolean;
    }
  | {
      type: "graphforge/saveEntityEdit";
      kind: EntityInspectSelection["kind"];
      id: string;
      properties: Record<string, unknown>;
    }
  | { type: "graphforge/openResultDocument"; kind: "json" | "markdown" }
  | { type: "graphforge/requestReload" }
  | { type: "graphforge/explainMode" }
  | { type: "graphforge/openOntologyFile" }
  | { type: "graphforge/runCommand"; command: string; args?: unknown[] }
) &
  Partial<VisualizationMessageContext>;
