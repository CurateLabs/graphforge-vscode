import type {
  GraphEdge,
  GraphNode,
  OntologyDoc,
  OntologyMode,
} from "../session/types";
import type { ResultPage } from "../session/resultRows";
import type { GetStartedState } from "../views/getStartedView";
import type { VisualizationMessageContext } from "./visualizationInstanceRegistry";

export type EntityInspectSelection =
  { kind: "node"; item: GraphNode } | { kind: "edge"; item: GraphEdge };

export interface ResultEntityLink {
  kind: EntityInspectSelection["kind"];
  id: string;
  label: string;
}

export interface ResultMessageContext {
  resultId: string;
  revision: number;
  pageVersion: number;
}

export type ResultPageDirection = "next" | "previous" | "selection" | "reset";

export type HostToWebview =
  | { type: "graphforge/entityInspect"; selection: EntityInspectSelection }
  | (ResultMessageContext & {
      type: "graphforge/results";
      title: string;
      result: ResultPage;
      persisted?: { jsonPath: string; markdownPath: string };
      entityLinks?: Record<string, ResultEntityLink[]>;
      inspectNotice?: string;
      direction?: ResultPageDirection;
      selectedRows?: number[];
      selectedCount?: number;
      focusRow?: number;
    })
  | (ResultMessageContext & {
      type: "graphforge/resultsLoading";
      title: string;
      rowCount: number;
      persisted: boolean;
      reset: boolean;
    })
  | (ResultMessageContext & { type: "graphforge/resultsError"; message: string })
  | (ResultMessageContext & { type: "graphforge/resultsCleared"; message: string })
  | (ResultMessageContext & {
      type: "graphforge/resultSelection";
      message: string;
      linked: boolean;
    })
  | (ResultMessageContext & {
      type: "graphforge/highlightResultRows";
      rowIndices: number[];
      selectedCount: number;
      focusRow?: number;
    })
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
  | (ResultMessageContext & { type: "graphforge/selectResult"; rowIndex: number; column?: string })
  | (ResultMessageContext & { type: "graphforge/requestResultPage"; offset: number; direction: "next" | "previous" })
  | (ResultMessageContext & {
      type: "graphforge/openResultEntity";
      rowIndex: number;
      kind: EntityInspectSelection["kind"];
      id: string;
      shiftKey?: boolean;
    })
  | {
      type: "graphforge/saveEntityEdit";
      kind: EntityInspectSelection["kind"];
      id: string;
      properties: Record<string, unknown>;
    }
  | (ResultMessageContext & { type: "graphforge/openResultDocument"; kind: "json" | "markdown" })
  | { type: "graphforge/requestReload" }
  | { type: "graphforge/explainMode" }
  | { type: "graphforge/openOntologyFile" }
  | { type: "graphforge/runCommand"; command: string; args?: unknown[] }
) &
  Partial<VisualizationMessageContext>;
