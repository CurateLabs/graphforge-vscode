import type { ExperienceMode, ExperienceModeCard } from "../session/experienceMode";
import type { ProjectKind } from "../session/projectKind";

/**
 * Pure Get Started view content (#26, #29, #37), split out of
 * `getStartedView.ts` so it can be unit tested directly under plain mocha
 * without a `vscode` dependency (same convention as `runtimeSelection.ts` /
 * `experienceMode.ts`).
 */
export interface GetStartedAction {
  label: string;
  command: string;
}

export interface RuntimeStepActions {
  primaryAction?: GetStartedAction;
  secondaryAction?: GetStartedAction;
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
