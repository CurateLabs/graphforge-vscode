import * as vscode from "vscode";
import type { OntologyDoc, OntologyMode } from "../session/types";
import type { HostToWebview, WebviewToHost } from "./protocol";

export class OntologyPanel {
  public static current: OntologyPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private mode: OntologyMode = "exploratory";
  private ontology: OntologyDoc | undefined;
  private projectName: string | undefined;

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.onDidDispose(() => {
      OntologyPanel.current = undefined;
    });
    this.panel.webview.onDidReceiveMessage((msg: WebviewToHost) => {
      if (msg.type === "graphforge/ready") {
        this.post();
      }
    });
    this.panel.webview.html = this.getHtml(this.panel.webview);
  }

  static show(
    _extensionUri: vscode.Uri,
    opts: { mode: OntologyMode; ontology?: OntologyDoc; projectName?: string },
  ): OntologyPanel {
    if (OntologyPanel.current) {
      OntologyPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      OntologyPanel.current.update(opts);
      return OntologyPanel.current;
    }

    const panel = vscode.window.createWebviewPanel(
      "graphforge.ontologyViewer",
      "GraphForge Ontology",
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    OntologyPanel.current = new OntologyPanel(panel);
    OntologyPanel.current.update(opts);
    return OntologyPanel.current;
  }

  update(opts: {
    mode: OntologyMode;
    ontology?: OntologyDoc;
    projectName?: string;
  }): void {
    this.mode = opts.mode;
    this.ontology = opts.ontology;
    this.projectName = opts.projectName;
    this.panel.title = opts.projectName
      ? `Ontology: ${opts.projectName}`
      : "GraphForge Ontology";
    this.post();
  }

  private post(): void {
    const msg: HostToWebview = {
      type: "graphforge/ontology",
      mode: this.mode,
      ontology: this.ontology,
      projectName: this.projectName,
    };
    void this.panel.webview.postMessage(msg);
  }

  private getHtml(webview: vscode.Webview): string {
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource} 'unsafe-inline'`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ontology</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0; padding: 16px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
    }
    .badge {
      display: inline-block; padding: 2px 8px; border-radius: 4px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
    }
    h1 { font-size: 16px; margin: 8px 0 4px; }
    h2 { font-size: 13px; margin: 20px 0 8px; border-bottom: 1px solid var(--vscode-panel-border, #444); padding-bottom: 4px; }
    .muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
    ul { padding-left: 18px; margin: 0; }
    li { margin: 4px 0; font-size: 12px; }
    .entity { font-weight: 600; }
    .rel { font-family: var(--vscode-editor-font-family); }
    .empty { margin-top: 24px; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <span class="badge" id="mode">—</span>
  <h1 id="title">Ontology</h1>
  <p class="muted" id="meta"></p>
  <div id="content" class="empty">No ontology loaded. Progressive mode starts exploratory (no ontology required).</div>
  <script>
    const vscode = acquireVsCodeApi();
    const modeEl = document.getElementById('mode');
    const titleEl = document.getElementById('title');
    const metaEl = document.getElementById('meta');
    const content = document.getElementById('content');

    function render(msg) {
      modeEl.textContent = 'mode: ' + (msg.mode || 'unknown');
      titleEl.textContent = msg.projectName ? ('Ontology — ' + msg.projectName) : 'Ontology';
      const o = msg.ontology;
      if (!o) {
        content.className = 'empty';
        content.textContent = 'No committed ontology in workspace participant. Use GraphForge: Load Ontology… or continue in exploratory mode.';
        metaEl.textContent = '';
        return;
      }
      metaEl.textContent = [o.ontology_id, o.version != null ? 'v' + o.version : ''].filter(Boolean).join(' · ');
      const entities = o.entity_types || [];
      const relations = o.relation_types || [];
      const props = o.properties || [];

      let html = '';
      html += '<h2>Entity types (' + entities.length + ')</h2><ul>';
      html += entities.map(e =>
        '<li><span class="entity">' + e.name + '</span>' +
        (e.parent ? ' <span class="muted">⊂ ' + e.parent + '</span>' : '') +
        (e.abstract ? ' <span class="muted">abstract</span>' : '') +
        '</li>'
      ).join('') || '<li class="muted">(none)</li>';
      html += '</ul>';

      html += '<h2>Relation types (' + relations.length + ')</h2><ul>';
      html += relations.map(r =>
        '<li class="rel">' + r.name + ' : ' + r.src + ' → ' + r.dst +
        (r.inverse ? ' <span class="muted">inv ' + r.inverse + '</span>' : '') +
        '</li>'
      ).join('') || '<li class="muted">(none)</li>';
      html += '</ul>';

      html += '<h2>Properties (' + props.length + ')</h2><ul>';
      html += props.map(p =>
        '<li>' + p.owner + '.' + p.name + ' : ' + p.type +
        (p.nullable ? ' <span class="muted">nullable</span>' : '') +
        '</li>'
      ).join('') || '<li class="muted">(none)</li>';
      html += '</ul>';

      content.className = '';
      content.innerHTML = html;
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg && msg.type === 'graphforge/ontology') render(msg);
    });
    vscode.postMessage({ type: 'graphforge/ready' });
  </script>
</body>
</html>`;
  }
}
