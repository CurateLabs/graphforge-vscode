import * as vscode from "vscode";
import type { GraphPayload } from "../session/types";
import {
  CLASS_COLOR_PALETTE,
  EPISTEMIC_COLORS,
  type HostToWebview,
  type WebviewToHost,
} from "./protocol";

export class ResultGraphPanel {
  public static current: ResultGraphPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private payload: GraphPayload | undefined;

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.onDidDispose(() => {
      ResultGraphPanel.current = undefined;
    });
    this.panel.webview.onDidReceiveMessage((msg: WebviewToHost) => {
      if (msg.type === "graphforge/ready" && this.payload) {
        this.postGraph(this.payload);
      }
    });
    this.panel.webview.html = this.getHtml(this.panel.webview);
  }

  static show(extensionUri: vscode.Uri, payload?: GraphPayload): ResultGraphPanel {
    if (ResultGraphPanel.current) {
      ResultGraphPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      if (payload) {
        ResultGraphPanel.current.update(payload);
      }
      return ResultGraphPanel.current;
    }

    const panel = vscode.window.createWebviewPanel(
      "graphforge.resultGraph",
      "GraphForge Result Graph",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      },
    );
    ResultGraphPanel.current = new ResultGraphPanel(panel);
    if (payload) {
      ResultGraphPanel.current.update(payload);
    }
    return ResultGraphPanel.current;
  }

  update(payload: GraphPayload): void {
    this.payload = payload;
    this.panel.title = payload.title
      ? `GraphForge: ${payload.title}`
      : "GraphForge Result Graph";
    this.postGraph(payload);
  }

  private postGraph(payload: GraphPayload): void {
    const msg: HostToWebview = { type: "graphforge/graph", payload };
    void this.panel.webview.postMessage(msg);
  }

  private getHtml(webview: vscode.Webview): string {
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource} 'unsafe-inline'`,
    ].join("; ");

    const colorsJson = JSON.stringify(EPISTEMIC_COLORS);
    const classPaletteJson = JSON.stringify(CLASS_COLOR_PALETTE);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Result Graph</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --muted: var(--vscode-descriptionForeground);
      --border: var(--vscode-panel-border, #444);
    }
    body {
      margin: 0;
      font-family: var(--vscode-font-family);
      background: var(--bg);
      color: var(--fg);
      display: grid;
      grid-template-rows: auto 1fr auto;
      height: 100vh;
    }
    header, footer {
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      font-size: 12px;
    }
    footer { border-bottom: none; border-top: 1px solid var(--border); }
    h1 { font-size: 13px; margin: 0 0 4px; font-weight: 600; }
    .legend { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-top: 6px; }
    .swatch {
      display: inline-flex; align-items: center; gap: 6px;
      color: var(--muted);
    }
    .dot {
      width: 10px; height: 10px; border-radius: 50%;
      border: 1px solid color-mix(in srgb, var(--fg) 30%, transparent);
    }
    #canvas-wrap { position: relative; overflow: hidden; }
    svg { width: 100%; height: 100%; display: block; }
    .node circle { stroke: var(--fg); stroke-width: 1.2; }
    .node text { fill: var(--fg); font-size: 11px; pointer-events: none; }
    .edge { stroke: var(--muted); stroke-width: 1.5; fill: none; opacity: 0.85; }
    .empty { padding: 24px; color: var(--muted); }
    .banner {
      margin-top: 6px; padding: 4px 8px; border-radius: 3px; font-size: 11px;
      background: var(--vscode-inputValidation-infoBackground, rgba(255,255,255,0.06));
      border: 1px solid var(--vscode-inputValidation-infoBorder, var(--border));
      display: none;
    }
  </style>
</head>
<body>
  <header>
    <h1 id="title">Result Graph</h1>
    <div class="legend" id="status-legend"></div>
    <div class="legend" id="type-legend"></div>
    <div class="banner" id="banner"></div>
  </header>
  <div id="canvas-wrap">
    <svg id="svg" xmlns="http://www.w3.org/2000/svg"></svg>
    <div class="empty" id="empty">Waiting for graph data…</div>
  </div>
  <footer id="footer">Colors are extension-owned. Epistemic when the knowledge ledger is resolvable, otherwise class-only.</footer>
  <script>
    const vscode = acquireVsCodeApi();
    const COLORS = ${colorsJson};
    const CLASS_PALETTE = ${classPaletteJson};
    const svg = document.getElementById('svg');
    const empty = document.getElementById('empty');
    const titleEl = document.getElementById('title');
    const statusLegend = document.getElementById('status-legend');
    const typeLegend = document.getElementById('type-legend');
    const banner = document.getElementById('banner');
    const footer = document.getElementById('footer');

    function classColor(name) {
      const key = name || '(none)';
      let hash = 0;
      for (let i = 0; i < key.length; i++) {
        hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
      }
      return CLASS_PALETTE[hash % CLASS_PALETTE.length];
    }

    function classOf(n) {
      return n.ontologyType || (n.labels && n.labels[0]) || 'Node';
    }

    function renderLegend(styleMode, statuses, types) {
      const epistemic = styleMode === 'epistemic' || styleMode === 'demo';
      statusLegend.style.display = epistemic ? 'flex' : 'none';
      statusLegend.innerHTML = epistemic ? statuses.map(s =>
        '<span class="swatch"><span class="dot" style="background:' + (COLORS[s] || '#888') + '"></span>' + s + '</span>'
      ).join('') : '';
      typeLegend.innerHTML = types.map(t =>
        '<span class="swatch"><span class="dot" style="background:' + (epistemic ? 'transparent' : classColor(t)) + '; border-style:' + (epistemic ? 'dashed' : 'solid') + '"></span>class: ' + t + '</span>'
      ).join('');
    }

    function layout(nodes) {
      const w = svg.clientWidth || 640;
      const h = svg.clientHeight || 400;
      const cx = w / 2, cy = h / 2;
      const r = Math.min(w, h) * 0.32;
      return nodes.map((n, i) => {
        const angle = (2 * Math.PI * i) / Math.max(nodes.length, 1) - Math.PI / 2;
        return { ...n, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
      });
    }

    function render(payload) {
      const styleMode = payload.styleMode || 'class-only';
      const epistemic = styleMode === 'epistemic' || styleMode === 'demo';
      titleEl.textContent = payload.title || 'Result Graph';
      renderLegend(styleMode, payload.legend.statuses || [], payload.legend.types || []);

      if (payload.banner) {
        banner.textContent = payload.banner;
        banner.style.display = 'block';
      } else {
        banner.style.display = 'none';
      }

      const nodes = layout(payload.nodes || []);
      const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
      const edges = payload.edges || [];

      if (!nodes.length) {
        empty.style.display = 'block';
        svg.innerHTML = '';
        return;
      }
      empty.style.display = 'none';

      const edgeColor = (e) => epistemic
        ? (COLORS[e.epistemicStatus || 'statusless'] || '#888')
        : 'var(--muted)';

      const edgeLines = edges.map(e => {
        const a = byId[e.source], b = byId[e.target];
        if (!a || !b) return '';
        return '<line class="edge" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="' + edgeColor(e) + '" />' +
          '<text x="' + ((a.x+b.x)/2) + '" y="' + ((a.y+b.y)/2 - 6) + '" fill="currentColor" font-size="10" text-anchor="middle">' + (e.type || '') + '</text>';
      }).join('');

      const nodeEls = nodes.map(n => {
        const cls = classOf(n);
        const color = epistemic ? (COLORS[n.epistemicStatus || 'statusless'] || '#888') : classColor(cls);
        const label = (n.properties && (n.properties.name || n.properties.label)) || n.labels[0] || n.id.slice(0, 8);
        return '<g class="node" data-id="' + n.id + '">' +
          '<circle cx="' + n.x + '" cy="' + n.y + '" r="18" fill="' + color + '" fill-opacity="0.85" />' +
          '<text x="' + n.x + '" y="' + (n.y + 32) + '" text-anchor="middle">' + String(label).slice(0, 24) + '</text>' +
          '<text x="' + n.x + '" y="' + (n.y + 4) + '" text-anchor="middle" font-size="9" fill="#fff">' + cls.slice(0, 8) + '</text>' +
          '</g>';
      }).join('');

      svg.innerHTML = edgeLines + nodeEls;
      const styleLabel = styleMode === 'epistemic' ? 'epistemic styling'
        : styleMode === 'demo' ? 'demo styling'
        : 'class-only styling';
      footer.textContent = nodes.length + ' nodes · ' + edges.length + ' edges · ' + styleLabel;
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg && msg.type === 'graphforge/graph') {
        render(msg.payload);
      }
    });

    vscode.postMessage({ type: 'graphforge/ready' });
  </script>
</body>
</html>`;
  }
}
