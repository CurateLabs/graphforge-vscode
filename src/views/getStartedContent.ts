import type { ProjectKind } from "../session/projectKind";

/** A command exposed by one node in the persistent startup journey. */
export interface GetStartedAction {
  label: string;
  command: string;
  /** Optional `executeCommand` args for project-owned artifacts. */
  args?: unknown[];
}

export type GetStartedStepStatus = "pending" | "done" | "current";

/** One visible node in Environment → Project → Query → Result → Visualize. */
export interface GetStartedStepModel {
  id: string;
  title: string;
  detail: string;
  /** A real artifact path, or the explicit path the step will create. */
  artifact?: string;
  status: GetStartedStepStatus;
  primaryAction?: GetStartedAction;
  secondaryAction?: GetStartedAction;
}

export interface ChecklistStepInput {
  runtimeReady: boolean;
  projectReady: boolean;
  hasLastResult: boolean;
  hasResultArtifact: boolean;
  hasSavedVisualization: boolean;
  isSampleProject: boolean;
  projectName?: string;
  activeRuntime?: string;
  nodeLine: string;
  pythonLine: string;
  projectKind: ProjectKind;
  snapshotActive?: string;
  sampleQueryPath?: string;
  resultPath?: string;
  visualizationPath?: string;
}

export interface RuntimeStepActions {
  primaryAction?: GetStartedAction;
  secondaryAction?: GetStartedAction;
}

export interface JourneyResultArtifact {
  path: string;
}

export interface JourneyVisualizationArtifact {
  path: string;
  result: string;
  kind?: string;
  format?: string;
  renderer?: string;
}

/**
 * Choose only a result/visualization pair that can actually be reopened.
 * The quickstart's supporting temporal result must not pretend the saved
 * routes query has run, and a visualization with a missing source is not a
 * completed journey step.
 */
export function selectJourneyArtifacts(
  isSampleProject: boolean,
  results: readonly JourneyResultArtifact[],
  visualizations: readonly JourneyVisualizationArtifact[],
  preferredGraphRenderer = "cytoscape",
): { resultPath?: string; visualizationPath?: string } {
  const resultPath = isSampleProject
    ? results.find((item) => item.path === "results/query-result.json")?.path
    : results[0]?.path;
  const matchingVisualizations = resultPath
    ? visualizations.filter((item) => item.result === resultPath)
    : [];
  const visualizationPath =
    (isSampleProject
      ? matchingVisualizations.find(
          (item) =>
            item.kind === "geospatial" &&
            item.renderer === "l7" &&
            item.format === "graphforge.visualization/v2",
        )?.path
      : undefined) ??
    matchingVisualizations.find(
      (item) =>
        item.kind === "result-graph" &&
        item.renderer === preferredGraphRenderer &&
        item.format === "graphforge.visualization/v2",
    )?.path ??
    matchingVisualizations.find(
      (item) =>
        item.kind === "result-graph" &&
        item.renderer === preferredGraphRenderer,
    )?.path ??
    matchingVisualizations.find(
      (item) =>
        item.kind === "result-graph" &&
        item.format === "graphforge.visualization/v2",
    )?.path ??
    matchingVisualizations.find((item) => item.kind === "result-graph")?.path ??
    matchingVisualizations[0]?.path;
  return { resultPath, visualizationPath };
}

const SETUP_NODE_ACTION: GetStartedAction = {
  label: "Set up Node",
  command: "graphforge.setupNativeBinding",
};

const SETUP_PYTHON_ACTION: GetStartedAction = {
  label: "Set up Python",
  command: "graphforge.setupPythonBinding",
};

const CHECK_ENVIRONMENT_ACTION: GetStartedAction = {
  label: "Check details",
  command: "graphforge.checkEnvironment",
};

/** Lead with the runtime setup most likely to work in the current workspace. */
export function runtimeStepActions(
  runtimeReady: boolean,
  projectKind: ProjectKind,
): RuntimeStepActions {
  if (runtimeReady) {
    return {};
  }
  return {
    primaryAction:
      projectKind === "python" ? SETUP_PYTHON_ACTION : SETUP_NODE_ACTION,
    secondaryAction: CHECK_ENVIRONMENT_ACTION,
  };
}

function stepStatus(done: boolean, available: boolean): GetStartedStepStatus {
  if (done) return "done";
  return available ? "current" : "pending";
}

/**
 * Build the persistent shortest path to user value.
 *
 * Status follows durable evidence wherever possible: project FORMAT, saved
 * result JSON, and saved visualization JSON. Session state is used only when
 * it proves the result table is currently usable.
 */
export function buildChecklistSteps(input: ChecklistStepInput): GetStartedStepModel[] {
  const {
    runtimeReady,
    projectReady,
    hasLastResult,
    hasResultArtifact,
    hasSavedVisualization,
    isSampleProject,
    projectName,
    activeRuntime,
    nodeLine,
    pythonLine,
    projectKind,
    snapshotActive,
    sampleQueryPath,
    resultPath,
    visualizationPath,
  } = input;

  const runtimeStep: GetStartedStepModel = {
    id: "environment",
    title: "Environment",
    detail: runtimeReady
      ? `${nodeLine}; ${pythonLine}.`
      : `${nodeLine}. ${pythonLine}. Choose one runtime to continue.`,
    artifact: runtimeReady
      ? `Runtime: ${activeRuntime ?? snapshotActive ?? "auto"}`
      : undefined,
    status: runtimeReady ? "done" : "current",
    ...runtimeStepActions(runtimeReady, projectKind),
  };

  const projectStep: GetStartedStepModel = {
    id: "project",
    title: "Project",
    detail: projectReady
      ? `Working in ${projectName ?? "GraphForge project"}.`
      : "Open a GraphForge project, initialize an empty folder, or use the sample.",
    artifact: projectReady ? "FORMAT · graphforge-project/v1" : undefined,
    status: stepStatus(projectReady, runtimeReady),
    primaryAction:
      runtimeReady && !projectReady
        ? { label: "Open project", command: "graphforge.openProject" }
        : undefined,
    secondaryAction:
      runtimeReady && !projectReady
        ? { label: "Try the air-routes sample", command: "graphforge.openSampleProject" }
        : undefined,
  };

  const queryComplete = hasLastResult || hasResultArtifact;
  const queryStep: GetStartedStepModel = {
    id: "query",
    title: "Query",
    detail: !projectReady
      ? "Available after a project is open."
      : queryComplete
        ? "A saved query has produced a durable result."
        : isSampleProject
          ? "Run the saved routes query, or explore the same CSVs in Python."
          : "Write and run a saved Cypher query.",
    artifact: sampleQueryPath ?? (projectReady ? "queries/first-query.cypher" : undefined),
    status: stepStatus(queryComplete, runtimeReady && projectReady),
    primaryAction:
      runtimeReady && projectReady && !queryComplete
        ? isSampleProject && sampleQueryPath
          ? {
              label: "Run sample query",
              command: "graphforge.runProjectQuery",
              args: [{ path: sampleQueryPath }],
            }
          : {
              label: "Write and run query",
              command: "graphforge.getStarted.showQuery",
            }
        : undefined,
    secondaryAction:
      runtimeReady && projectReady && isSampleProject
        ? {
            label: "Open Python notebook",
            command: "graphforge.openSampleNotebook",
          }
        : undefined,
  };

  const resultComplete = hasLastResult || hasSavedVisualization;
  const resultAvailable = hasResultArtifact;
  const resultStep: GetStartedStepModel = {
    id: "result",
    title: "Result",
    detail: !resultAvailable && !hasLastResult
      ? "Your query result will appear here and in the Results panel."
      : resultComplete
        ? "The result is ready to inspect and reuse."
        : "Open the saved result in the Results panel.",
    artifact: resultPath ?? (projectReady ? "results/query-result.json" : undefined),
    status: stepStatus(resultComplete, resultAvailable),
    primaryAction:
      !resultComplete && resultAvailable && resultPath
        ? {
            label: "Inspect result",
            command: "graphforge.openProjectResult",
            args: [{ path: resultPath }],
          }
        : undefined,
  };

  const visualizationAvailable = resultComplete;
  const visualizationStep: GetStartedStepModel = {
    id: "visualize",
    title: "Visualize",
    detail: hasSavedVisualization
      ? "A reusable visualization is saved in the project."
      : visualizationAvailable
        ? "Create a graph, chart, map, or timeline from the saved result."
        : "Available after the first result is saved.",
    artifact:
      visualizationPath ??
      (projectReady ? "visualizations/first-graph.gfviz.json" : undefined),
    status: stepStatus(hasSavedVisualization, visualizationAvailable),
    primaryAction: hasSavedVisualization && visualizationPath
      ? {
          label: "Open saved visualization",
          command: "graphforge.openProjectVisualization",
          args: [{ path: visualizationPath, waitForReady: true, timeoutMs: 60_000 }],
        }
      : visualizationAvailable
        ? {
            label: "Create visualization",
            command: "graphforge.getStarted.showVisualize",
          }
        : undefined,
  };

  return [runtimeStep, projectStep, queryStep, resultStep, visualizationStep];
}
