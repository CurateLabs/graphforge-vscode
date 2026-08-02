import type { ExperienceMode } from "../session/experienceMode";
import type {
  EpistemicStatus,
  GraphEdge,
  GraphNode,
  GraphPayload,
  OntologyDoc,
  OntologyMode,
  QueryResult,
} from "../session/types";
import type { GetStartedState } from "../views/getStartedView";
import type {
  ResultGraphBackend,
  ResultGraphLabelOptions,
  ResultGraphLayoutOptions,
  ResultGraphOptionSource,
  ResultGraphRenderer,
  ResultGraphTimebarOptions,
  ResultGraphVisualDensityOptions,
} from "./resultGraphModel";

export type ResultGraphRenderPhase =
  | "initialize"
  | "layout"
  | "render"
  | "interaction";

export type EntityInspectSelection =
  | { kind: "node"; item: GraphNode }
  | { kind: "edge"; item: GraphEdge };

export interface ResultEntityLink {
  kind: EntityInspectSelection["kind"];
  id: string;
  label: string;
}

export type HostToWebview =
  | { type: "graphforge/graph"; payload: GraphPayload }
  | { type: "graphforge/graphRenderer"; renderer: ResultGraphRenderer }
  | {
      type: "graphforge/graphOptions";
      backend?: ResultGraphBackend;
      source?: ResultGraphOptionSource;
      layout?: ResultGraphLayoutOptions;
      visualDensity?: ResultGraphVisualDensityOptions;
      labels?: ResultGraphLabelOptions;
      timebar?: ResultGraphTimebarOptions;
    }
  | { type: "graphforge/graphArtifactState"; saved: boolean; dirty: boolean }
  | { type: "graphforge/entityInspect"; selection: EntityInspectSelection }
  | {
      type: "graphforge/highlightGraphElements";
      nodeIds: string[];
      edgeIds: string[];
    }
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
  | { type: "graphforge/status"; message: string };

export type WebviewToHost =
  | { type: "graphforge/ready" }
  | { type: "graphforge/selectNode"; id: string; shiftKey?: boolean }
  | { type: "graphforge/selectEdge"; id: string; shiftKey?: boolean }
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
  | {
      type: "graphforge/renderStarted";
      renderer: ResultGraphRenderer;
      backend?: ResultGraphBackend;
      layout?: ResultGraphLayoutOptions["type"];
      nodeCount: number;
      edgeCount: number;
    }
  | {
      type: "graphforge/layoutStarted";
      renderer: ResultGraphRenderer;
      layout: ResultGraphLayoutOptions["type"];
      execution: "worker" | "main";
    }
  | {
      type: "graphforge/layoutReady";
      renderer: ResultGraphRenderer;
      layout: ResultGraphLayoutOptions["type"];
      execution: "worker" | "main";
      durationMs: number;
    }
  | {
      type: "graphforge/renderReady";
      renderer: ResultGraphRenderer;
      backend?: ResultGraphBackend;
      nodeCount: number;
      edgeCount: number;
      durationMs: number;
    }
  | {
      type: "graphforge/renderFailed";
      renderer: ResultGraphRenderer;
      phase: ResultGraphRenderPhase;
      code: string;
      backend?: ResultGraphBackend;
      layout?: ResultGraphLayoutOptions["type"];
      message: string;
    }
  | { type: "graphforge/timebarChanged"; values: [number, number] }
  | { type: "graphforge/saveGraphArtifactState" }
  | { type: "graphforge/revertGraphArtifactState" }
  | { type: "graphforge/requestReload" }
  | { type: "graphforge/explainMode" }
  | { type: "graphforge/openOntologyFile" }
  | { type: "graphforge/runCommand"; command: string; args?: unknown[] }
  | { type: "graphforge/selectExperienceMode"; mode: ExperienceMode };

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
