import * as vscode from "vscode";

/**
 * Shared editor group for GraphForge visualization webviews (Result Graph,
 * Figure, Ontology). The first panel opens beside the active editor. Later
 * panels target the live anchor panel's concrete editor column, so they do not
 * depend on VS Code applying a preceding reveal/focus operation first.
 *
 * `ViewColumn.Active` is deliberately avoided in the normal path: commands
 * posted by the Get Started webview can arrive back-to-back while the original
 * text editor is still VS Code's active group.
 */
const livePanels = new Set<vscode.WebviewPanel>();
let anchorPanel: vscode.WebviewPanel | undefined;
let anchorColumn: vscode.ViewColumn | undefined;

export interface VizPanelShowOptions {
  viewColumn: vscode.ViewColumn;
  preserveFocus: boolean;
}

export function graphForgeVizShowOptions(): VizPanelShowOptions {
  if (!anchorPanel) {
    return {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: false,
    };
  }

  const viewColumn = panelColumn(anchorPanel);
  if (viewColumn !== undefined) {
    anchorColumn = viewColumn;
    return {
      viewColumn,
      preserveFocus: false,
    };
  }

  // A newly created panel normally exposes viewColumn synchronously. Keep this
  // fallback for transient view-state gaps; the tracked concrete column still
  // avoids opening another group.
  return {
    viewColumn: anchorColumn ?? vscode.ViewColumn.Active,
    preserveFocus: false,
  };
}

/** Reveal an existing visualization in the shared group and anchor later opens to it. */
export function revealVizPanel(panel: vscode.WebviewPanel): void {
  const viewColumn =
    (anchorPanel && anchorPanel !== panel ? panelColumn(anchorPanel) : undefined) ??
    panelColumn(panel) ??
    anchorColumn;
  panel.reveal(viewColumn, false);
  // onDidChangeViewState is asynchronous; update synchronously so a command
  // immediately opening another visualization cannot observe the old anchor.
  anchorPanel = panel;
  anchorColumn = viewColumn ?? panelColumn(panel);
}

/** Call once per webview panel from its constructor. */
export function trackVizPanel(panel: vscode.WebviewPanel): void {
  livePanels.add(panel);
  anchorPanel = panel;
  anchorColumn = panelColumn(panel) ?? anchorColumn;

  panel.onDidChangeViewState(() => {
    if (panel.active) {
      anchorPanel = panel;
      anchorColumn = panelColumn(panel) ?? anchorColumn;
    }
  });
  panel.onDidDispose(() => {
    livePanels.delete(panel);
    if (anchorPanel === panel) {
      anchorPanel =
        [...livePanels].find((candidate) => candidate.active) ??
        [...livePanels].find((candidate) => candidate.visible) ??
        livePanels.values().next().value;
    }
    anchorColumn = anchorPanel ? panelColumn(anchorPanel) : undefined;
  });
}

function panelColumn(panel: vscode.WebviewPanel): vscode.ViewColumn | undefined {
  if (panel.viewColumn !== undefined) {
    return panel.viewColumn;
  }

  // tabGroups reflects the editor group itself and is a useful fallback during
  // short windows where WebviewPanel.viewColumn is temporarily undefined.
  const viewType = normalizeViewType(panel.viewType);
  for (const group of vscode.window.tabGroups.all) {
    const hasPanelType = group.tabs.some(
      (tab) =>
        tab.input instanceof vscode.TabInputWebview &&
        normalizeViewType(tab.input.viewType) === viewType,
    );
    if (hasPanelType) {
      return group.viewColumn;
    }
  }
  return undefined;
}

function normalizeViewType(viewType: string): string {
  return viewType.replace(/^mainThreadWebview-/, "");
}
