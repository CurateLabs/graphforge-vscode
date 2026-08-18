import type { ProjectVisualizationSpecV2 } from "../session/visualizationRegistry";
import type { QueryResult } from "../session/types";
import type { VisualizationMessageContext } from "./visualizationInstanceRegistry";

export type ArtifactVisualizationSpec = Extract<
  ProjectVisualizationSpecV2,
  { kind: "chart" | "geospatial" | "temporal" }
>;

export type ArtifactRenderPhase = "initialize" | "render" | "interaction";

export type ArtifactVisualizationHostToWebview = (
  | {
      type: "graphforge/artifactVisualization";
      path: string;
      spec: ArtifactVisualizationSpec;
      result: QueryResult;
      dirty: boolean;
    }
  | { type: "graphforge/artifactCommitted"; spec: ArtifactVisualizationSpec }
  | { type: "graphforge/artifactReverted"; spec: ArtifactVisualizationSpec }
  | { type: "graphforge/artifactDirty"; dirty: boolean }
  | { type: "graphforge/artifactError"; message: string }
) & VisualizationMessageContext;

export type ArtifactVisualizationWebviewToHost = (
  | { type: "graphforge/ready" }
  | { type: "graphforge/renderStarted"; kind: ArtifactVisualizationSpec["kind"]; renderer: string }
  | {
      type: "graphforge/renderReady";
      kind: ArtifactVisualizationSpec["kind"];
      renderer: string;
      rowCount: number;
      durationMs: number;
    }
  | {
      type: "graphforge/renderFailed";
      kind: ArtifactVisualizationSpec["kind"];
      renderer: string;
      phase: ArtifactRenderPhase;
      code: string;
      message: string;
    }
  | { type: "graphforge/artifactStateChanged"; spec: ArtifactVisualizationSpec }
  | { type: "graphforge/saveArtifactState" }
  | { type: "graphforge/revertArtifactState" }
  | { type: "graphforge/selectResult"; rowIndex: number }
) & Partial<VisualizationMessageContext>;
