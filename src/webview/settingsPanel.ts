import * as crypto from "node:crypto";
import * as vscode from "vscode";
import {
  allSettingDescriptors,
  SETTINGS_SECTION,
  type SettingsHostToWebview,
  type SettingsValues,
  type SettingsWebviewToHost,
} from "./settingsSchema";

/**
 * GraphForge Settings panel (#24): Kilo-style left-nav categories over the
 * existing `graphforge.*` settings. The UI itself is the Vite-built app in
 * `webview-ui/src/settings/` (output: `dist/webview-ui/settings.{js,css}`);
 * this class only serves the shell HTML and round-trips values through
 * `workspace.getConfiguration` so the panel and the VS Code Settings UI
 * always agree.
 */
export class SettingsPanel {
  public static current: SettingsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.panel.onDidDispose(() => {
      SettingsPanel.current = undefined;
      for (const disposable of this.disposables.splice(0)) {
        disposable.dispose();
      }
    });
    this.panel.webview.onDidReceiveMessage((msg: SettingsWebviewToHost) => {
      if (msg.type === "graphforge/ready") {
        this.postValues();
      } else if (msg.type === "graphforge/updateSetting") {
        void this.updateSetting(msg.key, msg.value);
      }
    });
    // Keep the panel live: edits made in the VS Code Settings UI (or by
    // Welcome's mode picker) reflect here without reopening.
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(SETTINGS_SECTION)) {
          this.postValues();
        }
      }),
    );
    this.panel.webview.html = this.getHtml(this.panel.webview, extensionUri);
  }

  static show(extensionUri: vscode.Uri): SettingsPanel {
    if (SettingsPanel.current) {
      SettingsPanel.current.panel.reveal();
      SettingsPanel.current.postValues();
      return SettingsPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      "graphforge.settings",
      "GraphForge Settings",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist", "webview-ui")],
      },
    );
    SettingsPanel.current = new SettingsPanel(panel, extensionUri);
    return SettingsPanel.current;
  }

  private async updateSetting(key: string, value: string | boolean | number): Promise<void> {
    const descriptor = allSettingDescriptors().find((setting) => setting.key === key);
    if (!descriptor) {
      return; // unknown key from a stale webview — ignore, never write
    }
    if (descriptor.type === "enum") {
      const valid = descriptor.options?.some((option) => option.value === value);
      if (!valid) {
        return;
      }
    } else if (descriptor.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return;
      }
    } else if (typeof value !== (descriptor.type === "boolean" ? "boolean" : "string")) {
      return;
    }
    const config = vscode.workspace.getConfiguration(SETTINGS_SECTION);
    try {
      await config.update(key, value, vscode.ConfigurationTarget.Global);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `GraphForge: could not save setting "${key}" (${err instanceof Error ? err.message : String(err)}).`,
      );
      this.postValues(); // re-sync the control back to the persisted value
    }
  }

  private postValues(): void {
    const config = vscode.workspace.getConfiguration(SETTINGS_SECTION);
    const values: SettingsValues = {};
    for (const setting of allSettingDescriptors()) {
      values[setting.key] = config.get(setting.key, setting.default);
    }
    const msg: SettingsHostToWebview = { type: "graphforge/settingsState", values };
    void this.panel.webview.postMessage(msg);
  }

  private getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const assetsRoot = vscode.Uri.joinPath(extensionUri, "dist", "webview-ui");
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, "settings.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, "settings.css"));
    const nonce = crypto.randomBytes(16).toString("base64url");
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>GraphForge Settings</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
