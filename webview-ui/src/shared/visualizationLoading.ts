import {
  visualizationLoadingState,
  type VisualizationLoadingInput,
} from "../../../src/webview/visualizationLoadingModel";

export interface VisualizationLoadingController {
  update(input: VisualizationLoadingInput): void;
  hide(): void;
}

export function createVisualizationLoadingController(
  root: HTMLElement | null,
  busyTarget: HTMLElement | null,
  summaryTarget?: HTMLElement | null,
): VisualizationLoadingController {
  let hideTimer: number | undefined;
  const renderer = root?.querySelector<HTMLElement>("[data-render-status-renderer]");
  const title = root?.querySelector<HTMLElement>("[data-render-status-title]");
  const detail = root?.querySelector<HTMLElement>("[data-render-status-detail]");
  const steps = root?.querySelector<HTMLOListElement>("[data-render-status-steps]");

  const hide = (): void => {
    if (hideTimer !== undefined) window.clearTimeout(hideTimer);
    hideTimer = undefined;
    if (root) root.hidden = true;
    busyTarget?.setAttribute("aria-busy", "false");
  };

  return {
    update: (input) => {
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
      hideTimer = undefined;
      const state = visualizationLoadingState(input);
      if (root) {
        root.hidden = false;
        root.dataset.phase = input.phase;
      }
      busyTarget?.setAttribute(
        "aria-busy",
        input.phase === "ready" || input.phase === "failed" ? "false" : "true",
      );
      if (renderer) renderer.textContent = `Render pipeline · ${state.rendererName}`;
      if (title) title.textContent = state.title;
      if (detail) detail.textContent = state.detail;
      if (steps) {
        steps.replaceChildren(...state.steps.map((step) => {
          const item = document.createElement("li");
          item.dataset.state = step.state;
          const marker = document.createElement("span");
          marker.className = "render-status-marker";
          marker.setAttribute("aria-hidden", "true");
          const label = document.createElement("span");
          label.textContent = step.label;
          item.append(marker, label);
          return item;
        }));
      }
      if (summaryTarget) {
        summaryTarget.textContent = `${state.rendererName} · ${state.title} · ${state.detail}`;
      }
      if (input.phase === "ready") {
        hideTimer = window.setTimeout(hide, 650);
      }
    },
    hide,
  };
}
