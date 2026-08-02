import type { ExperienceMode, ExperienceModeCard } from "../session/experienceMode";
import type { ProjectKind } from "../session/projectKind";

/**
 * Pure Get Started view content (#26, #29, #37, #63), split out of
 * `getStartedView.ts` so it can be unit tested directly under plain mocha
 * without a `vscode` dependency (same convention as `runtimeSelection.ts` /
 * `experienceMode.ts`).
 */
export interface GetStartedAction {
  label: string;
  command: string;
  /** Optional `executeCommand` args (agent / canned sample bindings — #63). */
  args?: unknown[];
}

export type GetStartedStepStatus = "pending" | "done" | "current";

export interface GetStartedStepModel {
  id: string;
  title: string;
  detail: string;
  status: GetStartedStepStatus;
  primaryAction?: GetStartedAction;
  secondaryAction?: GetStartedAction;
}

export interface GetStartedControlModel {
  id: string;
  title: string;
  detail: string;
  actions: GetStartedAction[];
}

export interface GetStartedWorkspaceModel {
  /** Guided milestones give way to the persistent workbench after the first result. */
  layout: "guided" | "hub";
  starter: GetStartedControlModel;
  controls: GetStartedControlModel[];
}

export interface ChecklistStepInput {
  runtimeReady: boolean;
  projectReady: boolean;
  hasLastResult: boolean;
  isSampleProject: boolean;
  projectName?: string;
  projectPath?: string;
  activeRuntime?: string;
  nodeLine: string;
  pythonLine: string;
  projectKind: ProjectKind;
  seenResultGraph: boolean;
  seenFigure: boolean;
  snapshotActive?: string;
  sampleQueryPath?: string;
  sampleFigurePath?: string;
}

export interface RuntimeStepActions {
  primaryAction?: GetStartedAction;
  secondaryAction?: GetStartedAction;
}

/**
 * Persistent entry points for Get Started.
 *
 * The starter space is deliberately independent of checklist gating: users
 * can always see what the sample is and invoke it. `openSampleProject` keeps
 * its runtime guard, while this copy makes that prerequisite explicit before
 * the user clicks. After the first result, these controls replace the
 * one-time checklist so Get Started remains useful as a workbench.
 */
export function buildWorkspaceModel(
  input: Pick<
    ChecklistStepInput,
    "runtimeReady" | "projectReady" | "hasLastResult" | "isSampleProject" | "projectName"
  >,
): GetStartedWorkspaceModel {
  const {
    runtimeReady,
    projectReady,
    hasLastResult,
    isSampleProject,
    projectName,
  } = input;
  const sampleDetail = isSampleProject
    ? "The air-routes starter space is open. Reopen it anytime to keep exploring the sample."
    : runtimeReady
      ? "Seed and open the US air-routes starter project, then run its ready-made query."
      : "Try the US air-routes starter project after choosing a Node or Python runtime below.";

  const starter: GetStartedControlModel = {
    id: "starter",
    title: "Starter space",
    detail: sampleDetail,
    actions: [
      {
        label: isSampleProject ? "Open sample project" : "Try sample project",
        command: "graphforge.openSampleProject",
      },
      { label: "Open your project", command: "graphforge.openProject" },
    ],
  };

  const projectDetail = projectReady
    ? `Current project: ${projectName ?? "GraphForge project"}.`
    : "Open an existing GraphForge project or switch to the starter space.";
  const resultDetail = hasLastResult
    ? "Run another query, reopen the table, or move between graph, figure, and inspection."
    : "Run a query first; result controls will guide you back if setup is incomplete.";

  return {
    layout: hasLastResult ? "hub" : "guided",
    starter,
    controls: [
      {
        id: "project-controls",
        title: "Project",
        detail: projectDetail,
        actions: [
          { label: "Open Project", command: "graphforge.openProject" },
          { label: "Open Sample", command: "graphforge.openSampleProject" },
        ],
      },
      {
        id: "explore-controls",
        title: "Query and results",
        detail: resultDetail,
        actions: [
          { label: "Run Query", command: "graphforge.runQuery" },
          { label: "Results Table", command: "graphforge.showResultsTable" },
          { label: "Result Graph", command: "graphforge.showResultGraph" },
          {
            label: "Figure",
            command: "graphforge.figureFromResult",
          },
          { label: "Find / Inspect", command: "graphforge.find" },
          { label: "Ontology", command: "graphforge.showOntology" },
        ],
      },
    ],
  };
}

const SETUP_NODE_ACTION: GetStartedAction = {
  label: "Setup Native (Node)",
  command: "graphforge.setupNativeBinding",
};

const SETUP_PYTHON_ACTION: GetStartedAction = {
  label: "Setup Python",
  command: "graphforge.setupPythonBinding",
};

/**
 * Which setup CTAs the runtime checklist step shows.
 *
 * - A `done` step shows no setup actions at all (#29) — a checkmarked step
 *   with a dangling "Setup Python" button reads as unresolved.
 * - While incomplete, the primary CTA mirrors `chooseRuntime`'s `auto`
 *   policy (FR-18, #37): Python-first workspaces lead with Setup Python;
 *   Node-ish and ambiguous workspaces keep the Node-first default.
 */
export function runtimeStepActions(
  runtimeReady: boolean,
  projectKind: ProjectKind,
): RuntimeStepActions {
  if (runtimeReady) {
    return {};
  }
  if (projectKind === "python") {
    return { primaryAction: SETUP_PYTHON_ACTION, secondaryAction: SETUP_NODE_ACTION };
  }
  return { primaryAction: SETUP_NODE_ACTION, secondaryAction: SETUP_PYTHON_ACTION };
}

/**
 * Runtime → project → query → see-results checklist steps (#63).
 * Pure so unit tests can lock done/current transitions without vscode.
 */
export function buildChecklistSteps(input: ChecklistStepInput): GetStartedStepModel[] {
  const {
    runtimeReady,
    projectReady,
    hasLastResult,
    isSampleProject,
    projectName,
    projectPath,
    activeRuntime,
    nodeLine,
    pythonLine,
    projectKind,
    seenResultGraph,
    seenFigure,
    snapshotActive,
    sampleQueryPath,
    sampleFigurePath,
  } = input;

  const runtimeStep: GetStartedStepModel = {
    id: "runtime",
    title: "Set up a runtime",
    detail: runtimeReady
      ? `Active: ${activeRuntime ?? snapshotActive ?? "auto"}. ${nodeLine}; ${pythonLine}.`
      : `${nodeLine}. ${pythonLine}. Link @curatelabs/graphforge or install graphforge with uv.`,
    status: runtimeReady ? "done" : "current",
    ...runtimeStepActions(runtimeReady, projectKind),
  };

  const projectStep: GetStartedStepModel = {
    id: "project",
    title: "Open or create a project",
    detail: projectReady
      ? `Working in ${projectName ?? "project"}${projectPath ? ` (${projectPath})` : ""}.`
      : "Pick a folder with a FORMAT marker, initialize an empty directory, or try the sample.",
    status: projectReady ? "done" : runtimeReady ? "current" : "pending",
    primaryAction: runtimeReady
      ? { label: "Open Project", command: "graphforge.openProject" }
      : undefined,
    secondaryAction: projectReady
      ? undefined
      : { label: "Try sample project", command: "graphforge.openSampleProject" },
  };

  const queryDetail = !projectReady
    ? "Available once a project is open and a runtime is active."
    : hasLastResult
      ? "Last query result is ready — open Result Graph or Chart below."
      : isSampleProject
        ? sampleQueryPath
          ? `Ready from the project: ${sampleQueryPath}`
          : "Open a query from the sample project's queries directory."
        : "Open a .cypher file or run a query from the command palette.";

  let queryStatus: GetStartedStepStatus = "pending";
  if (hasLastResult) {
    queryStatus = "done";
  } else if (projectReady && runtimeReady) {
    queryStatus = "current";
  }

  const queryStep: GetStartedStepModel = {
    id: "query",
    title: "Run your first query",
    detail: queryDetail,
    status: queryStatus,
    primaryAction:
      projectReady && runtimeReady && !hasLastResult
        ? isSampleProject
          ? {
              label: "Run sample query",
              command: sampleQueryPath
                ? "graphforge.runProjectQuery"
                : "graphforge.runQuery",
              args: sampleQueryPath ? [{ path: sampleQueryPath }] : undefined,
            }
          : { label: "Run Query", command: "graphforge.runQuery" }
        : undefined,
  };

  const seeBothDone = seenResultGraph && seenFigure;
  let seeStatus: GetStartedStepStatus = "pending";
  if (seeBothDone) {
    seeStatus = "done";
  } else if (hasLastResult) {
    seeStatus = "current";
  }

  const seeStep: GetStartedStepModel = {
    id: "see-results",
    title: "See your results",
    detail: !hasLastResult
      ? "After a query, open the Result Graph and a Figure chart."
      : seeBothDone
        ? "Result Graph and Figure are open — keep exploring from the sidebar."
        : "Open both views when you’re ready (nothing opens until you ask).",
    status: seeStatus,
    primaryAction: hasLastResult
      ? { label: "Show Result Graph", command: "graphforge.showResultGraph" }
      : undefined,
    secondaryAction: hasLastResult
      ? {
          label: "Chart this result",
          command: sampleFigurePath
            ? "graphforge.openProjectVisualization"
            : "graphforge.figureFromResult",
          args: sampleFigurePath ? [{ path: sampleFigurePath }] : undefined,
        }
      : undefined,
  };

  return [runtimeStep, projectStep, queryStep, seeStep];
}

/**
 * Welcome mode cards as an ARIA radio group (#26): `role="radio"` +
 * `aria-checked` per card with a roving `tabindex`, so keyboard and
 * screen-reader users can perceive and change the selection. The webview
 * script only toggles these attributes; the markup is rendered host-side so
 * it stays unit-testable. Card copy is trusted static content from
 * `EXPERIENCE_MODE_CARDS`.
 */
export function renderModeCardsHtml(
  cards: readonly ExperienceModeCard[],
  selectedMode: ExperienceMode,
): string {
  return cards
    .map((card) => {
      const selected = card.mode === selectedMode;
      return (
        `<div class="card${selected ? " selected" : ""}" role="radio"` +
        ` aria-checked="${selected}" tabindex="${selected ? 0 : -1}"` +
        ` data-mode="${card.mode}" aria-labelledby="mode-title-${card.mode}"` +
        ` aria-describedby="mode-tagline-${card.mode}">` +
        `<div class="card-head"><div class="radio" aria-hidden="true"></div>` +
        `<p class="card-title" id="mode-title-${card.mode}">${card.title}</p></div>` +
        `<p class="card-tagline" id="mode-tagline-${card.mode}">${card.tagline}</p>` +
        `<ul>${card.bullets.map((b) => `<li>${b}</li>`).join("")}</ul>` +
        `</div>`
      );
    })
    .join("");
}
