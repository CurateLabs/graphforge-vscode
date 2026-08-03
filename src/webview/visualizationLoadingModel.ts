export type VisualizationLoadingRenderer =
  | "g6"
  | "cytoscape"
  | "sigma"
  | "g2"
  | "l7"
  | "plotly";

export type VisualizationLoadingPhase =
  | "prepare"
  | "layout"
  | "paint"
  | "ready"
  | "failed";

export interface VisualizationLoadingInput {
  renderer: VisualizationLoadingRenderer;
  phase: VisualizationLoadingPhase;
  failedAt?: Exclude<VisualizationLoadingPhase, "ready" | "failed">;
  nodeCount?: number;
  edgeCount?: number;
  rowCount?: number;
  durationMs?: number;
  message?: string;
}

export interface VisualizationLoadingStep {
  label: string;
  state: "complete" | "current" | "pending" | "failed";
}

export interface VisualizationLoadingState {
  rendererName: string;
  title: string;
  detail: string;
  steps: VisualizationLoadingStep[];
}

interface RendererProfile {
  name: string;
  steps: readonly [string, string, string];
  titles: Record<Exclude<VisualizationLoadingPhase, "failed">, string>;
}

const PROFILES: Record<VisualizationLoadingRenderer, RendererProfile> = {
  g6: {
    name: "AntV G6",
    steps: ["Read graph", "ForceAtlas2", "Paint Canvas"],
    titles: {
      prepare: "Preparing graph data",
      layout: "Running ForceAtlas2 layout",
      paint: "Painting the Canvas",
      ready: "Graph ready",
    },
  },
  cytoscape: {
    name: "Cytoscape",
    steps: ["Read graph", "CoSE layout", "Paint Canvas"],
    titles: {
      prepare: "Preparing graph data",
      layout: "Running CoSE layout",
      paint: "Painting the Canvas",
      ready: "Graph ready",
    },
  },
  sigma: {
    name: "Sigma",
    steps: ["Read graph", "ForceAtlas2", "Paint WebGL"],
    titles: {
      prepare: "Preparing graph data",
      layout: "Running ForceAtlas2 layout",
      paint: "Painting with WebGL",
      ready: "Graph ready",
    },
  },
  g2: {
    name: "AntV G2",
    steps: ["Read rows", "Compose marks", "Paint chart"],
    titles: {
      prepare: "Preparing result rows",
      layout: "Composing marks and scales",
      paint: "Painting the chart",
      ready: "Chart ready",
    },
  },
  l7: {
    name: "AntV L7",
    steps: ["Read rows", "Build map scene", "Paint layers"],
    titles: {
      prepare: "Preparing geospatial rows",
      layout: "Building the map scene",
      paint: "Painting map layers",
      ready: "Map ready",
    },
  },
  plotly: {
    name: "Plotly",
    steps: ["Read rows", "Compose traces", "Paint chart"],
    titles: {
      prepare: "Preparing result rows",
      layout: "Composing Plotly traces",
      paint: "Painting the chart",
      ready: "Chart ready",
    },
  },
};

function countDetail(input: VisualizationLoadingInput): string {
  if (input.nodeCount !== undefined || input.edgeCount !== undefined) {
    return `${(input.nodeCount ?? 0).toLocaleString("en-US")} nodes · ${(input.edgeCount ?? 0).toLocaleString("en-US")} edges`;
  }
  if (input.rowCount !== undefined) {
    return `${input.rowCount.toLocaleString("en-US")} result rows`;
  }
  return "Local visualization pipeline";
}

function durationDetail(durationMs: number | undefined): string {
  if (durationMs === undefined) return "";
  if (durationMs < 1_000) return ` · ${Math.round(durationMs)} ms`;
  return ` · ${(durationMs / 1_000).toFixed(1)} s`;
}

export function visualizationLoadingState(
  input: VisualizationLoadingInput,
): VisualizationLoadingState {
  const profile = PROFILES[input.renderer];
  const effectivePhase = input.phase === "failed" ? input.failedAt ?? "prepare" : input.phase;
  const phaseIndex = effectivePhase === "prepare" ? 0 : effectivePhase === "layout" ? 1 : 2;
  const steps = profile.steps.map((label, index): VisualizationLoadingStep => ({
    label,
    state: input.phase === "ready"
      ? "complete"
      : index < phaseIndex
        ? "complete"
        : index > phaseIndex
          ? "pending"
          : input.phase === "failed"
            ? "failed"
            : "current",
  }));
  return {
    rendererName: profile.name,
    title: input.phase === "failed" ? `${profile.name} stopped` : profile.titles[input.phase],
    detail: input.message ?? `${countDetail(input)}${durationDetail(input.durationMs)}`,
    steps,
  };
}
