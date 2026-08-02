import * as crypto from "node:crypto";
import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import {
  artifactTimestamp,
  writeProjectMutation,
} from "../session/projectArtifacts";
import {
  serializeEntityMutation,
  withEditedProperties,
} from "./entityMutation";
import {
  entityInspectTitle,
  resolveEntityInspectOpenAction,
} from "./entityInspectModel";
import type {
  EntityInspectSelection,
  HostToWebview,
  WebviewToHost,
} from "./protocol";

/**
 * Reusable entity inspector. Normal selections update the primary panel;
 * modified selections create comparison tabs in the same editor group.
 */
export class EntityInspectPanel {
  private static primary: EntityInspectPanel | undefined;
  private static readonly livePanels = new Set<EntityInspectPanel>();
  private static inspectColumn: vscode.ViewColumn | undefined;
  private static session: GraphForgeSession | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  private selection: EntityInspectSelection;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    selection: EntityInspectSelection,
    private readonly isPrimary: boolean,
  ) {
    this.selection = selection;
    EntityInspectPanel.livePanels.add(this);
    EntityInspectPanel.rememberColumn(panel);

    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message: WebviewToHost) => {
        if (message.type === "graphforge/ready") {
          this.postSelection();
        } else if (message.type === "graphforge/saveEntityEdit") {
          void this.saveEdit(message.kind, message.id, message.properties);
        }
      }),
      this.panel.onDidChangeViewState(() => {
        EntityInspectPanel.rememberColumn(this.panel);
      }),
    );
    this.panel.onDidDispose(() => {
      for (const disposable of this.disposables.splice(0)) {
        disposable.dispose();
      }
      EntityInspectPanel.livePanels.delete(this);
      if (this.isPrimary && EntityInspectPanel.primary === this) {
        EntityInspectPanel.primary = undefined;
      }
      if (EntityInspectPanel.livePanels.size === 0) {
        EntityInspectPanel.inspectColumn = undefined;
      }
    });

    this.panel.webview.html = this.getHtml(this.panel.webview, extensionUri);
    this.update(selection);
  }

  static show(
    extensionUri: vscode.Uri,
    selection: EntityInspectSelection,
    openInNewTab: boolean,
  ): EntityInspectPanel {
    const action = resolveEntityInspectOpenAction(
      Boolean(EntityInspectPanel.primary),
      openInNewTab,
    );
    if (action === "update-primary" && EntityInspectPanel.primary) {
      EntityInspectPanel.primary.update(selection);
      EntityInspectPanel.primary.reveal();
      return EntityInspectPanel.primary;
    }

    const isPrimary = action === "create-primary";
    const viewColumn =
      EntityInspectPanel.primary?.column() ??
      EntityInspectPanel.inspectColumn ??
      vscode.ViewColumn.Beside;
    const panel = vscode.window.createWebviewPanel(
      "graphforge.entityInspect",
      entityInspectTitle(selection),
      { viewColumn, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist", "webview-ui")],
      },
    );
    const inspectPanel = new EntityInspectPanel(
      panel,
      extensionUri,
      selection,
      isPrimary,
    );
    if (isPrimary) {
      EntityInspectPanel.primary = inspectPanel;
    }
    return inspectPanel;
  }

  static configure(session: GraphForgeSession): void {
    EntityInspectPanel.session = session;
  }

  update(selection: EntityInspectSelection): void {
    this.selection = selection;
    this.panel.title = entityInspectTitle(selection);
    this.postSelection();
  }

  private reveal(): void {
    this.panel.reveal(
      this.column() ?? EntityInspectPanel.inspectColumn,
      true,
    );
  }

  private column(): vscode.ViewColumn | undefined {
    return (
      EntityInspectPanel.resolveColumn(this.panel) ??
      EntityInspectPanel.inspectColumn
    );
  }

  private postSelection(): void {
    const message: HostToWebview = {
      type: "graphforge/entityInspect",
      selection: this.selection,
    };
    this.post(message);
  }

  private async saveEdit(
    kind: EntityInspectSelection["kind"],
    id: string,
    properties: Record<string, unknown>,
  ): Promise<void> {
    if (this.selection.kind !== kind || this.selection.item.id !== id) {
      this.post({
        type: "graphforge/entityEditState",
        state: "error",
        message: "The inspected entity changed before this edit could be saved.",
      });
      return;
    }

    this.post({
      type: "graphforge/entityEditState",
      state: "saving",
      message: "Saving mutation…",
    });
    try {
      const session = EntityInspectPanel.session;
      const projectRoot = session?.project?.rootPath;
      if (!session || !projectRoot) {
        throw new Error(
          "Open a GraphForge project before saving entity changes.",
        );
      }

      const mutation = serializeEntityMutation(this.selection, properties);
      const mutationPath = writeProjectMutation(
        projectRoot,
        `edit-${kind}-${id.slice(0, 40)}-${artifactTimestamp()}`,
        mutation.cypher,
      );

      let applied = false;
      let warning: string | undefined;
      try {
        const result = await session.executeMutation(mutation.cypher);
        const updated = Number(result.rows[0]?.updated);
        applied = Number.isNaN(updated) || updated > 0;
        if (!applied) {
          warning =
            "The mutation was saved, but it matched no live graph entity.";
        }
      } catch (error) {
        warning = `The mutation was saved, but live apply failed: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }

      this.update(withEditedProperties(this.selection, mutation.properties));
      session.notifyChanged();
      this.post({
        type: "graphforge/entityEditState",
        state: "saved",
        mutationPath,
        applied,
        message:
          warning ??
          `Applied to the live graph and saved ${mutationPath}.`,
      });
    } catch (error) {
      this.post({
        type: "graphforge/entityEditState",
        state: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private post(message: HostToWebview): void {
    void this.panel.webview.postMessage(message);
  }

  private static rememberColumn(panel: vscode.WebviewPanel): void {
    const column = EntityInspectPanel.resolveColumn(panel);
    if (column !== undefined) {
      EntityInspectPanel.inspectColumn = column;
    }
  }

  private static resolveColumn(
    panel: vscode.WebviewPanel,
  ): vscode.ViewColumn | undefined {
    if (panel.viewColumn !== undefined) {
      return panel.viewColumn;
    }
    const viewType = panel.viewType.replace(/^mainThreadWebview-/, "");
    for (const group of vscode.window.tabGroups.all) {
      if (
        group.tabs.some(
          (tab) =>
            tab.input instanceof vscode.TabInputWebview &&
            tab.input.viewType.replace(/^mainThreadWebview-/, "") === viewType,
        )
      ) {
        return group.viewColumn;
      }
    }
    return undefined;
  }

  private getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const assetsRoot = vscode.Uri.joinPath(extensionUri, "dist", "webview-ui");
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(assetsRoot, "entityInspect.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(assetsRoot, "entityInspect.css"),
    );
    const nonce = crypto.randomBytes(16).toString("base64url");
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>GraphForge Entity Inspect</title>
</head>
<body>
  <main id="app" aria-live="polite">
    <p class="empty">Select a node or edge to inspect it.</p>
  </main>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
