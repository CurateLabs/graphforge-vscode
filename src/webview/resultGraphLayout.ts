export interface ResultGraphLayoutHandle {
  relayout(): void;
}

export type ResultGraphLayoutScheduler = (callback: () => void) => void;

/**
 * Run a renderer's initial force layout after it has been bound to the graph
 * container. Deferring one frame gives Cytoscape and Sigma a painted,
 * measurable viewport instead of laying out during constructor setup.
 */
export function scheduleInitialResultGraphLayout(
  handle: ResultGraphLayoutHandle,
  schedule: ResultGraphLayoutScheduler,
  isCurrent: () => boolean = () => true,
): void {
  schedule(() => {
    if (isCurrent()) {
      handle.relayout();
    }
  });
}
