import * as crypto from "node:crypto";
import * as vscode from "vscode";
import type { ModuleManager } from "../modules/moduleManager";
import type {
  ModulesHostToWebview,
  ModulesWebviewToHost,
} from "../modules/moduleProtocol";

export class ModuleManagerPanel {
  static current: ModuleManagerPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private readonly modules: ModuleManager,
  ) {
    panel.webview.html = this.getHtml(panel.webview, extensionUri);
    this.disposables.push(
      panel.onDidDispose(() => this.dispose()),
      modules.onDidChange(() => this.postState()),
      panel.webview.onDidReceiveMessage((message: ModulesWebviewToHost) => {
        void this.receive(message);
      }),
    );
  }

  static show(extensionUri: vscode.Uri, modules: ModuleManager): ModuleManagerPanel {
    if (this.current) {
      this.current.panel.reveal();
      this.current.postState();
      return this.current;
    }
    const panel = vscode.window.createWebviewPanel(
      "graphforge.modules",
      "GraphForge Modules",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist", "webview-ui")],
      },
    );
    this.current = new ModuleManagerPanel(panel, extensionUri, modules);
    return this.current;
  }

  private async receive(message: ModulesWebviewToHost): Promise<void> {
    try {
      if (message.type === "graphforge/ready") {
        this.postState();
      } else if (message.type === "graphforge/installFromFile") {
        const selected = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: true,
          canSelectMany: false,
          filters: { "GraphForge modules": ["json"] },
          openLabel: "Install module",
          title: "Select a .gfmodule.json file or module folder",
        });
        if (selected?.[0]) {
          const installed = await this.modules.installFromUri(selected[0]);
          if (installed) {
            void vscode.window.showInformationMessage("GraphForge: module installed.");
          }
        }
      } else if (message.type === "graphforge/install") {
        await this.modules.install(message.id);
      } else if (message.type === "graphforge/toggleModule") {
        await this.modules.setEnabled(message.id, message.enabled);
      } else if (message.type === "graphforge/removeModule") {
        const choice = await vscode.window.showWarningMessage(
          "Remove this GraphForge module? Its source files and project data will not be removed.",
          { modal: true },
          "Remove module",
        );
        if (choice === "Remove module") await this.modules.remove(message.id);
      } else if (message.type === "graphforge/runModuleAction") {
        await vscode.commands.executeCommand(message.command);
      } else if (message.type === "graphforge/openHomepage") {
        const model = this.modules.list().find((item) => item.id === message.id);
        if (model?.homepage) {
          await vscode.env.openExternal(vscode.Uri.parse(model.homepage));
        }
      }
    } catch (error) {
      void vscode.window.showErrorMessage(
        `GraphForge Modules: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.postState();
    }
  }

  private postState(): void {
    const message: ModulesHostToWebview = {
      type: "graphforge/modulesState",
      modules: this.modules.list(),
    };
    void this.panel.webview.postMessage(message);
  }

  private dispose(): void {
    ModuleManagerPanel.current = undefined;
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }

  private getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const root = vscode.Uri.joinPath(extensionUri, "dist", "webview-ui");
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(root, "modules.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(root, "modules.css"));
    const nonce = crypto.randomBytes(16).toString("base64url");
    const csp = [
      "default-src 'none'",
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
  <title>GraphForge Modules</title>
</head>
<body><div id="app"></div><script type="module" nonce="${nonce}" src="${scriptUri}"></script></body>
</html>`;
  }
}
