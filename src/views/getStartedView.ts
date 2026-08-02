import * as vscode from "vscode";
import {
  defaultsForExperienceMode,
  EXPERIENCE_MODE_CARDS,
  resolveExperienceMode,
  type ExperienceMode,
} from "../session/experienceMode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import type { HostToWebview, WebviewToHost } from "../webview/protocol";
import {
  buildChecklistSteps,
  buildWorkspaceModel,
  renderModeCardsHtml,
  type GetStartedControlModel,
  type GetStartedStepModel,
} from "./getStartedContent";
import { isQuickstartSamplePath } from "../session/quickstartSample";
import {
  scanProjectArtifacts,
  type ProjectArtifactIndex,
} from "../session/projectArtifacts";

export type GetStartedStepStatus = "pending" | "done" | "current";
export type GetStartedScreen = "welcome" | "checklist";
export type GetStartedPage = "hub" | "query" | "visualize";

export type GetStartedStep = GetStartedStepModel;

export interface GetStartedState {
  screen: GetStartedScreen;
  headline: string;
  subhead: string;
  steps: GetStartedStep[];
  mode: ExperienceMode;
  layout?: "guided" | "hub";
  starter?: GetStartedControlModel;
  controls?: GetStartedControlModel[];
  artifacts?: ProjectArtifactIndex;
  page: GetStartedPage;
}

/** Focus the GraphForge activity bar and refresh Get Started state. */
export async function revealGetStarted(provider: GetStartedViewProvider): Promise<void> {
  provider.showPage("hub");
  await vscode.commands.executeCommand("workbench.view.extension.graphforge");
  await vscode.commands.executeCommand("graphforge.getStarted.focus");
  await provider.refresh();
}

/** Focus Get Started and switch to a title-action-selected control surface. */
export async function revealGetStartedPage(
  provider: GetStartedViewProvider,
  page: GetStartedPage,
): Promise<void> {
  provider.showPage(page);
  await vscode.commands.executeCommand("workbench.view.extension.graphforge");
  await vscode.commands.executeCommand("graphforge.getStarted.focus");
  await provider.refresh();
}

/** Has the user ever completed (or skipped) the Welcome mode picker? */
function experienceModeChosen(): boolean {
  const inspected = vscode.workspace.getConfiguration("graphforge").inspect("experienceMode");
  return Boolean(
    inspected?.globalValue !== undefined ||
      inspected?.workspaceValue !== undefined ||
      inspected?.workspaceFolderValue !== undefined,
  );
}

function currentExperienceMode(): ExperienceMode {
  return resolveExperienceMode(
    vscode.workspace.getConfiguration("graphforge").get("experienceMode"),
  );
}

export class GetStartedViewProvider implements vscode.WebviewViewProvider {
  static instance: GetStartedViewProvider | undefined;

  private view: vscode.WebviewView | undefined;
  /** Set by "Change mode" to re-show Welcome without waiting for a reload. */
  private forceWelcome = false;
  private page: GetStartedPage = "hub";

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly session: GraphForgeSession,
  ) {
    GetStartedViewProvider.instance = this;
    session.onDidChange(() => {
      void this.refresh();
    });
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: WebviewToHost) => {
      if (msg.type === "graphforge/ready") {
        void this.refresh();
      } else if (msg.type === "graphforge/runCommand" && msg.command) {
        const args = Array.isArray(msg.args) ? msg.args : [];
        void vscode.commands.executeCommand(msg.command, ...args);
      } else if (msg.type === "graphforge/selectExperienceMode") {
        void this.completeWelcome(msg.mode);
      }
    });
    void this.refresh();
  }

  /** Re-show the Welcome mode picker (e.g. from the checklist's "Change mode" link). */
  showWelcome(): void {
    this.forceWelcome = true;
    this.page = "hub";
    void this.refresh();
  }

  showPage(page: GetStartedPage): void {
    this.page = page;
    void this.refresh();
  }

  private async completeWelcome(mode: ExperienceMode): Promise<void> {
    const config = vscode.workspace.getConfiguration("graphforge");
    const defaults = defaultsForExperienceMode(mode);
    await config.update("experienceMode", mode, vscode.ConfigurationTarget.Global);
    await config.update(
      "openResultGraphOnQuery",
      defaults.openResultGraphOnQuery,
      vscode.ConfigurationTarget.Global,
    );
    this.forceWelcome = false;
    this.page = "hub";
    this.session.notifyChanged();
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }
    const screen: GetStartedScreen =
      this.forceWelcome || !experienceModeChosen() ? "welcome" : "checklist";
    const state = await buildGetStartedState(this.session, screen, this.page);
    const msg: HostToWebview = { type: "graphforge/getStarted", state };
    void this.view.webview.postMessage(msg);
  }

  private getHtml(webview: vscode.Webview): string {
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource} 'unsafe-inline'`,
    ].join("; ");
    const cardsHtml = renderModeCardsHtml(EXPERIENCE_MODE_CARDS, "guided");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Get Started</title>
  <style>
    :root { color-scheme: light dark; --gf-accent: #4c6ef5; }
    body {
      margin: 0; padding: 16px 14px 24px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }
    .header { text-align: center; margin-bottom: 20px; }
    .logo {
      display: block; width: 40px; height: 40px; margin: 0 auto 10px;
      color: var(--vscode-foreground);
    }
    h1 { font-size: 15px; font-weight: 600; margin: 0 0 6px; letter-spacing: -0.01em; }
    .subhead {
      font-size: 12px; line-height: 1.45;
      color: var(--vscode-descriptionForeground); margin: 0;
    }
    .page[hidden] { display: none; }
    .banner {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
      border-radius: 8px; padding: 8px 10px; margin-bottom: 14px;
      background: color-mix(in srgb, var(--gf-accent) 12%, var(--vscode-editor-background));
      font-size: 11px;
    }
    .banner .mode-label { font-weight: 600; }
    .banner button.link { padding: 0; font-size: 11px; }
    .cards { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
    .card {
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
      border-radius: 10px; padding: 12px; cursor: pointer;
      background: var(--vscode-editor-background);
      text-align: left;
    }
    .card.selected {
      border-color: var(--gf-accent);
      box-shadow: 0 0 0 1px var(--gf-accent) inset;
    }
    .card:focus-visible {
      outline: 2px solid var(--vscode-focusBorder, var(--gf-accent));
      outline-offset: 2px;
    }
    .card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .radio {
      flex-shrink: 0; width: 14px; height: 14px; border-radius: 50%;
      border: 2px solid var(--vscode-panel-border, rgba(128,128,128,0.6));
    }
    .card.selected .radio { border-color: var(--gf-accent); background: var(--gf-accent); }
    .card-title { font-size: 13px; font-weight: 600; margin: 0; }
    .card-tagline {
      font-size: 11px; color: var(--vscode-descriptionForeground); margin: 0 0 8px;
    }
    .card ul { margin: 0; padding-left: 18px; }
    .card li {
      font-size: 11px; line-height: 1.5; color: var(--vscode-descriptionForeground);
    }
    .step {
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
      border-radius: 8px;
      padding: 12px 12px 10px;
      margin-bottom: 10px;
      background: var(--vscode-editor-background);
    }
    .step.done { opacity: 0.72; }
    .step-head { display: flex; align-items: flex-start; gap: 10px; }
    .badge {
      flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 600;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .step.done .badge { background: var(--gf-accent); color: #fff; }
    .step.current .badge {
      border: 2px solid var(--gf-accent);
      background: transparent;
      color: var(--gf-accent);
    }
    .step-title { font-size: 13px; font-weight: 600; margin: 0 0 4px; }
    .step-detail {
      font-size: 11px; line-height: 1.4;
      color: var(--vscode-descriptionForeground); margin: 0;
    }
    .section-label {
      margin: 16px 0 8px; font-size: 11px; font-weight: 600;
      color: var(--vscode-descriptionForeground); text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .control {
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
      border-radius: 8px; padding: 12px; margin-bottom: 10px;
      background: var(--vscode-editor-background);
    }
    .control.starter {
      border-color: color-mix(in srgb, var(--gf-accent) 65%, var(--vscode-panel-border));
      background: color-mix(in srgb, var(--gf-accent) 9%, var(--vscode-editor-background));
    }
    .control-title { font-size: 13px; font-weight: 600; margin: 0 0 4px; }
    .control-detail {
      font-size: 11px; line-height: 1.45;
      color: var(--vscode-descriptionForeground); margin: 0;
    }
    .actions { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px; }
    button {
      font-family: var(--vscode-font-family);
      font-size: 11px; border: none; border-radius: 4px;
      padding: 5px 10px; cursor: pointer;
    }
    button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.primary:hover { background: var(--vscode-button-hoverBackground); }
    button.primary.full { width: 100%; padding: 8px 10px; font-weight: 600; }
    button.secondary {
      background: var(--vscode-button-secondaryBackground, transparent);
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
    }
    .artifact-list { display: flex; flex-direction: column; gap: 6px; }
    .artifact {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
      padding: 8px; border-radius: 6px; background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
    }
    .artifact-name { font-size: 11px; font-weight: 600; word-break: break-word; }
    .artifact-meta {
      display: block; margin-top: 2px; font-size: 10px;
      color: var(--vscode-descriptionForeground); word-break: break-all;
    }
    .artifact .actions { margin-top: 0; flex-shrink: 0; }
    .form {
      display: flex; flex-direction: column; gap: 8px; padding: 10px;
      border-radius: 8px; background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
    }
    label, legend { font-size: 10px; font-weight: 600; color: var(--vscode-descriptionForeground); }
    input, select, textarea {
      box-sizing: border-box; width: 100%; margin-top: 3px; padding: 5px 6px;
      color: var(--vscode-input-foreground); background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px;
      font-family: var(--vscode-font-family); font-size: 11px;
    }
    textarea { min-height: 116px; resize: vertical; font-family: var(--vscode-editor-font-family); }
    input:focus, select:focus, textarea:focus {
      outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px;
    }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
    .empty-copy { font-size: 11px; color: var(--vscode-descriptionForeground); }
    .footer {
      margin-top: 14px; text-align: center;
    }
    button.link {
      background: none; color: var(--vscode-textLink-foreground);
      text-decoration: underline; padding: 4px;
    }
  </style>
</head>
<body>
  <div class="header">
    <svg class="logo" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 5.07L20 5.07M4 5.07L12 18.93M20 5.07L12 18.93" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="4" cy="5.07" r="3.2" fill="currentColor"/>
      <circle cx="20" cy="5.07" r="3.2" fill="currentColor"/>
      <circle cx="12" cy="18.93" r="3.2" fill="currentColor"/>
    </svg>
    <h1 id="headline">Get started with GraphForge</h1>
    <p class="subhead" id="subhead"></p>
  </div>
  <div id="hub-page" class="page">
    <div id="banner"></div>
    <div id="cards" class="cards" role="radiogroup" aria-label="Choose how you want to work">${cardsHtml}</div>
    <div id="continue"><button class="primary full" id="continue-btn">Continue</button></div>
    <div id="starter"></div>
    <div id="steps"></div>
    <div id="controls"></div>
  </div>
  <div id="query-page" class="page" hidden>
    <p class="section-label">Draft query</p>
    <form id="query-form" class="form">
      <label>Template name (optional)<input id="query-name" placeholder="query-YYYYMMDD-HHMMSS-mmm" /></label>
      <label>Result name (optional)<input id="result-name" placeholder="results-YYYYMMDD-HHMMSS-mmm" /></label>
      <label>Cypher<textarea id="query-cypher" required placeholder="MATCH (n) RETURN n LIMIT 25"></textarea></label>
      <div class="actions">
        <button class="primary" type="submit">Save template &amp; run</button>
        <button class="secondary" type="button" id="run-query">Run</button>
        <button class="secondary" type="button" id="save-template">Save template</button>
      </div>
    </form>
    <p class="section-label">Query templates</p>
    <div id="template-list" class="artifact-list"></div>
    <p class="section-label">Project queries</p>
    <div id="query-list" class="artifact-list"></div>
    <p class="section-label">Result history</p>
    <div id="result-list" class="artifact-list"></div>
  </div>
  <div id="visualize-page" class="page" hidden>
    <p class="section-label">Create visualization</p>
    <form id="visualization-form" class="form">
      <label>Name (optional)<input id="viz-name" placeholder="vis-YYYYMMDD-HHMMSS-mmm" /></label>
      <label>Result file<select id="viz-result" required></select></label>
      <label>View type<select id="viz-kind">
        <option value="result-graph">Result Graph</option>
        <option value="chart">Analytical chart</option>
        <option value="geospatial">Geospatial map</option>
        <option value="temporal">Temporal chart</option>
      </select></label>
      <div id="graph-settings">
        <label>Renderer<select id="viz-renderer"><option value="g6">AntV G6</option><option value="cytoscape">Cytoscape</option><option value="sigma">Sigma</option></select></label>
      </div>
      <div id="chart-settings" hidden>
        <label>Renderer<select id="viz-chart-renderer"><option value="g2">AntV G2</option><option value="plotly">Plotly</option></select></label>
        <label>Chart type<select id="viz-chart-type">
          <option>scatter</option><option>bar</option><option>line</option><option>histogram</option>
        </select></label>
        <div class="form-row">
          <label>X<select id="viz-x"></select></label>
          <label>Y<select id="viz-y"></select></label>
        </div>
        <label>Color / series<select id="viz-color"></select></label>
      </div>
      <div id="geospatial-settings" hidden>
        <div class="form-row">
          <label>Longitude field<select id="viz-longitude"></select></label>
          <label>Latitude field<select id="viz-latitude"></select></label>
        </div>
        <p class="muted">Saved explicitly as EPSG:4326 coordinates rendered on an offline blank L7 map.</p>
      </div>
      <div id="temporal-settings" hidden>
        <label>Renderer<select id="viz-temporal-renderer"><option value="g2">AntV G2</option></select></label>
        <div class="form-row">
          <label>Timestamp field<select id="viz-timestamp"></select></label>
          <label>Value field<select id="viz-temporal-value"></select></label>
        </div>
        <div class="form-row">
          <label>Timezone<input id="viz-timezone" value="UTC" /></label>
          <label>Granularity<select id="viz-granularity"><option>day</option><option>hour</option><option>week</option><option>month</option><option>quarter</option><option>year</option></select></label>
        </div>
        <label>Series field<select id="viz-temporal-series"></select></label>
      </div>
      <div class="form-row">
        <label>Filter column<select id="viz-filter-column"></select></label>
        <label>Filter mode<select id="viz-filter-operator"><option value="equals">equals</option><option value="contains">contains</option></select></label>
      </div>
      <label>Filter value (optional)<input id="viz-filter-value" /></label>
      <button class="primary" type="submit">Save &amp; open</button>
    </form>
    <p class="section-label">Saved visualizations</p>
    <div id="visualization-list" class="artifact-list"></div>
  </div>
  <div class="footer">
    <button class="link" id="refresh">Check Environment</button>
    <button class="link" id="open-settings">Settings</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    let selectedMode = 'guided';
    let currentState;

    const byId = (id) => document.getElementById(id);
    const escapeHtml = (value) => String(value)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    const runCommand = (command, args) =>
      vscode.postMessage({ type: 'graphforge/runCommand', command, args: args ? [args] : undefined });

    function artifactRow(item, actions, meta) {
      return '<div class="artifact"><div><span class="artifact-name">' +
        escapeHtml(item.name) + '</span><span class="artifact-meta">' +
        escapeHtml(meta || item.path) + '</span></div><div class="actions">' +
        actions.map((action) => actionButton(action.primary ? 'primary' : 'secondary', {
          label: action.label,
          command: action.command,
          args: [{ path: item.path }],
        })).join('') + '</div></div>';
    }

    function renderArtifacts(artifacts) {
      const queries = artifacts?.queries || [];
      const templates = artifacts?.queryTemplates || [];
      const results = artifacts?.results || [];
      const visualizations = artifacts?.visualizations || [];
      byId('template-list').innerHTML = templates.length
        ? templates.map((item) => artifactRow(item, [
            { label: 'Run', command: 'graphforge.runProjectQuery', primary: true },
            { label: 'Open', command: 'graphforge.openProjectArtifact' },
          ])).join('')
        : '<p class="empty-copy">Save a reusable query to create queries/templates/&hellip;</p>';
      byId('query-list').innerHTML = queries.length
        ? queries.map((item) => artifactRow(item, [
            { label: 'Run', command: 'graphforge.runProjectQuery', primary: true },
            { label: 'Open', command: 'graphforge.openProjectArtifact' },
          ])).join('')
        : '<p class="empty-copy">No one-off queries in queries/.</p>';
      byId('result-list').innerHTML = results.length
        ? results.map((item) => artifactRow(item, [
            { label: 'Table', command: 'graphforge.openProjectResult', primary: true },
            { label: 'JSON', command: 'graphforge.openProjectArtifact' },
          ], item.rowCount + ' rows · ' + item.path)).join('')
        : '<p class="empty-copy">Run a query to create durable result history.</p>';
      byId('visualization-list').innerHTML = visualizations.length
        ? visualizations.map((item) => artifactRow(item, [
            { label: 'Open', command: 'graphforge.openProjectVisualization', primary: true },
            { label: 'JSON', command: 'graphforge.openProjectArtifact' },
          ], item.kind + ' · ' + item.result)).join('')
        : '<p class="empty-copy">Save a visualization above to create visualizations/&hellip;</p>';
      [
        byId('template-list'),
        byId('query-list'),
        byId('result-list'),
        byId('visualization-list'),
      ].forEach(bindActions);

      const resultSelect = byId('viz-result');
      const previous = resultSelect.value;
      resultSelect.innerHTML = results.map((item) =>
        '<option value="' + escapeHtml(item.path) + '">' + escapeHtml(item.name) + '</option>'
      ).join('');
      if (results.some((item) => item.path === previous)) resultSelect.value = previous;
      updateColumnOptions();
    }

    function selectedResult() {
      return currentState?.artifacts?.results?.find((item) => item.path === byId('viz-result').value);
    }

    function updateColumnOptions() {
      const columns = selectedResult()?.columns || [];
      ['viz-x', 'viz-y', 'viz-color', 'viz-longitude', 'viz-latitude', 'viz-timestamp', 'viz-temporal-value', 'viz-temporal-series', 'viz-filter-column'].forEach((id) => {
        const select = byId(id);
        const old = select.value;
        const empty = id === 'viz-color' || id === 'viz-temporal-series' || id === 'viz-filter-column'
          ? '<option value="">(none)</option>' : '';
        select.innerHTML = empty + columns.map((column) =>
          '<option value="' + escapeHtml(column) + '">' + escapeHtml(column) + '</option>'
        ).join('');
        if (columns.includes(old)) select.value = old;
      });
    }

    byId('viz-result').addEventListener('change', updateColumnOptions);
    byId('viz-kind').addEventListener('change', () => {
      const kind = byId('viz-kind').value;
      byId('graph-settings').hidden = kind !== 'result-graph';
      byId('chart-settings').hidden = kind !== 'chart';
      byId('geospatial-settings').hidden = kind !== 'geospatial';
      byId('temporal-settings').hidden = kind !== 'temporal';
    });

    function currentQueryArgs() {
      return {
        name: byId('query-name').value,
        cypher: byId('query-cypher').value,
        resultName: byId('result-name').value,
      };
    }
    function saveTemplate(run) {
      if (!byId('query-form').reportValidity()) return;
      runCommand('graphforge.saveProjectQueryTemplate', {
        ...currentQueryArgs(),
        run,
      });
    }
    byId('query-form').addEventListener('submit', (event) => {
      event.preventDefault();
      saveTemplate(true);
    });
    byId('run-query').addEventListener('click', () => {
      if (!byId('query-form').reportValidity()) return;
      runCommand('graphforge.runQuery', currentQueryArgs());
    });
    byId('save-template').addEventListener('click', () => saveTemplate(false));

    byId('visualization-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const kind = byId('viz-kind').value;
      const filterValue = byId('viz-filter-value').value.trim();
      const filterColumn = byId('viz-filter-column').value;
      const common = {
        name: byId('viz-name').value,
        kind,
        result: byId('viz-result').value,
        filter: filterValue && filterColumn ? {
          column: filterColumn,
          operator: byId('viz-filter-operator').value,
          value: filterValue,
        } : undefined,
      };
      const args = kind === 'result-graph' ? {
        ...common,
        renderer: byId('viz-renderer').value,
      } : kind === 'chart' ? {
        ...common,
        renderer: byId('viz-chart-renderer').value,
        mark: byId('viz-chart-type').value,
        x: byId('viz-x').value,
        y: byId('viz-chart-type').value === 'histogram' ? undefined : byId('viz-y').value,
        color: byId('viz-color').value || undefined,
      } : kind === 'geospatial' ? {
        ...common,
        renderer: 'l7',
        longitude: byId('viz-longitude').value,
        latitude: byId('viz-latitude').value,
      } : {
        ...common,
        renderer: byId('viz-temporal-renderer').value,
        mark: 'line',
        timestamp: byId('viz-timestamp').value,
        y: byId('viz-temporal-value').value,
        color: byId('viz-temporal-series').value || undefined,
        timezone: byId('viz-timezone').value,
        granularity: byId('viz-granularity').value,
      };
      runCommand('graphforge.createProjectVisualization', {
        ...args,
        open: true,
      });
    });

    document.getElementById('refresh').addEventListener('click', () =>
      vscode.postMessage({ type: 'graphforge/runCommand', command: 'graphforge.checkEnvironment' })
    );
    document.getElementById('open-settings').addEventListener('click', () =>
      vscode.postMessage({ type: 'graphforge/runCommand', command: 'graphforge.openSettings' })
    );

    function renderBanner(mode) {
      const bannerEl = document.getElementById('banner');
      bannerEl.innerHTML =
        '<div class="banner">' +
          '<span><span class="mode-label">' + (mode === 'autonomous' ? 'Autonomous' : 'Guided') + '</span> mode</span>' +
          '<button class="link" id="change-mode">Change mode</button>' +
        '</div>';
      document.getElementById('change-mode').addEventListener('click', () =>
        vscode.postMessage({ type: 'graphforge/runCommand', command: 'graphforge.chooseExperienceMode' })
      );
    }

    // Mode cards are an ARIA radio group (rendered host-side): the script
    // only moves the selection — aria-checked + roving tabindex — so
    // keyboard and screen-reader users can operate it.
    const modeCards = Array.from(document.querySelectorAll('#cards .card'));

    function setSelectedMode(mode, focus) {
      selectedMode = mode;
      modeCards.forEach((card) => {
        const isSelected = card.getAttribute('data-mode') === mode;
        card.classList.toggle('selected', isSelected);
        card.setAttribute('aria-checked', String(isSelected));
        card.setAttribute('tabindex', isSelected ? '0' : '-1');
        if (isSelected && focus) card.focus();
      });
    }

    modeCards.forEach((card, i) => {
      card.addEventListener('click', () =>
        setSelectedMode(card.getAttribute('data-mode'), false)
      );
      card.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          e.preventDefault();
          setSelectedMode(modeCards[(i + 1) % modeCards.length].getAttribute('data-mode'), true);
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
          e.preventDefault();
          setSelectedMode(modeCards[(i - 1 + modeCards.length) % modeCards.length].getAttribute('data-mode'), true);
        } else if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          setSelectedMode(card.getAttribute('data-mode'), false);
        }
      });
    });

    document.getElementById('continue-btn').addEventListener('click', () =>
      vscode.postMessage({ type: 'graphforge/selectExperienceMode', mode: selectedMode })
    );

    function actionButton(cls, action) {
      const argsAttr = action.args
        ? ' data-args="' + encodeURIComponent(JSON.stringify(action.args)) + '"'
        : '';
      return '<button class="' + cls + '" data-cmd="' + action.command + '"' + argsAttr + '>' +
        action.label + '</button>';
    }

    function bindActions(root) {
      root.querySelectorAll('[data-cmd]').forEach((btn) => {
        btn.addEventListener('click', () => {
          let args;
          const raw = btn.getAttribute('data-args');
          if (raw) {
            try { args = JSON.parse(decodeURIComponent(raw)); } catch (_) { args = undefined; }
          }
          vscode.postMessage({
            type: 'graphforge/runCommand',
            command: btn.getAttribute('data-cmd'),
            args: args,
          });
        });
      });
    }

    function controlHtml(control, extraClass) {
      const actions = control.actions.map((action, i) =>
        actionButton(i === 0 ? 'primary' : 'secondary', action)
      );
      return '<section class="control ' + (extraClass || '') + '">' +
        '<p class="control-title">' + control.title + '</p>' +
        '<p class="control-detail">' + control.detail + '</p>' +
        '<div class="actions">' + actions.join('') + '</div>' +
      '</section>';
    }

    function renderStarter(starter) {
      const starterEl = document.getElementById('starter');
      starterEl.innerHTML =
        '<p class="section-label">Start here</p>' + controlHtml(starter, 'starter');
      bindActions(starterEl);
    }

    function renderControls(controls) {
      const controlsEl = document.getElementById('controls');
      controlsEl.innerHTML =
        '<p class="section-label">Workbench</p>' +
        controls.map((control) => controlHtml(control, '')).join('');
      bindActions(controlsEl);
    }

    function renderSteps(steps) {
      const stepsEl = document.getElementById('steps');
      stepsEl.innerHTML = '<p class="section-label">Guided setup</p>' + steps.map((step, i) => {
        const actions = [];
        if (step.primaryAction) {
          actions.push(actionButton('primary', step.primaryAction));
        }
        if (step.secondaryAction) {
          actions.push(actionButton('secondary', step.secondaryAction));
        }
        return '<div class="step ' + step.status + '">' +
          '<div class="step-head">' +
            '<div class="badge">' + (step.status === 'done' ? '✓' : (i + 1)) + '</div>' +
            '<div><p class="step-title">' + step.title + '</p>' +
            '<p class="step-detail">' + step.detail + '</p></div>' +
          '</div>' +
          (actions.length ? '<div class="actions">' + actions.join('') + '</div>' : '') +
        '</div>';
      }).join('');
      bindActions(stepsEl);
    }

    function render(state) {
      currentState = state;
      document.getElementById('headline').textContent = state.headline;
      document.getElementById('subhead').textContent = state.subhead;
      const isWelcome = state.screen === 'welcome';
      const page = isWelcome ? 'hub' : (state.page || 'hub');
      const isControlHubLayout = !isWelcome && state.layout === 'hub';
      ['hub', 'query', 'visualize'].forEach((name) => {
        byId(name + '-page').hidden = name !== page;
      });
      document.getElementById('banner').style.display = isWelcome ? 'none' : '';
      document.getElementById('cards').style.display = isWelcome ? '' : 'none';
      document.getElementById('continue').style.display = isWelcome ? '' : 'none';
      document.getElementById('starter').style.display =
        !isWelcome && !isControlHubLayout ? '' : 'none';
      document.getElementById('steps').style.display =
        !isWelcome && !isControlHubLayout ? '' : 'none';
      document.getElementById('controls').style.display = isControlHubLayout ? '' : 'none';
      if (isWelcome) {
        setSelectedMode(state.mode, false);
      } else {
        renderArtifacts(state.artifacts);
        renderBanner(state.mode);
        if (isControlHubLayout) {
          renderControls(state.controls || []);
        } else {
          if (state.starter) renderStarter(state.starter);
          renderSteps(state.steps);
        }
      }
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg && msg.type === 'graphforge/getStarted') render(msg.state);
    });
    vscode.postMessage({ type: 'graphforge/ready' });
  </script>
</body>
</html>`;
  }
}

export async function buildGetStartedState(
  session: GraphForgeSession,
  screen: GetStartedScreen = "checklist",
  page: GetStartedPage = "hub",
): Promise<GetStartedState> {
  const mode = currentExperienceMode();

  if (screen === "welcome") {
    return {
      screen,
      headline: "Welcome to GraphForge",
      subhead: "Choose how you want to work. You can change this anytime from Get Started.",
      steps: [],
      mode,
      page: "hub",
    };
  }

  const snapshot = await session.environmentSnapshot();
  const project = session.project;
  const runtimeReady = await session.hasUsableRuntime();
  const projectReady = Boolean(project);
  const nodeAvailable = snapshot.node.available;
  const pythonAvailable = snapshot.python.available;
  const activeRuntime = session.activeRuntime;
  const hasLastResult = session.hasLastResult;
  const isSampleProject = Boolean(
    project?.rootPath && isQuickstartSamplePath(project.rootPath),
  );
  const artifacts = project?.rootPath
    ? scanProjectArtifacts(project.rootPath)
    : { queries: [], queryTemplates: [], results: [], visualizations: [], mutations: [] };
  const sampleQueryPath = isSampleProject
    ? (artifacts.queryTemplates[0] ?? artifacts.queries[0])?.path
    : undefined;
  const sampleFigurePath = isSampleProject
    ? artifacts.visualizations.find((item) => item.kind === "plotly")?.path
    : undefined;

  const nodeLine = nodeAvailable ? "Node binding ready" : "Node binding not linked";
  const pythonLine = pythonAvailable
    ? `Python ready${snapshot.python.graphforgeVersion ? ` (graphforge ${snapshot.python.graphforgeVersion})` : ""}`
    : "Python runtime not configured";

  const steps = buildChecklistSteps({
    runtimeReady,
    projectReady,
    hasLastResult,
    isSampleProject,
    projectName: project?.name,
    projectPath: project?.rootPath,
    activeRuntime,
    nodeLine,
    pythonLine,
    projectKind: snapshot.projectKind,
    seenResultGraph: session.hasSeenResultGraph,
    seenFigure: session.hasSeenFigure,
    snapshotActive: snapshot.active,
    sampleQueryPath,
    sampleFigurePath,
  });
  const workspace = buildWorkspaceModel({
    runtimeReady,
    projectReady,
    hasLastResult,
    isSampleProject,
    projectName: project?.name,
  });

  let headline = "Get started with GraphForge";
  let subhead = "Guided setup — no stack traces here. Details live in Check Environment.";
  if (workspace.layout === "hub") {
    headline = "GraphForge control hub";
    subhead =
      "Open a project, run another query, and move between results without restarting setup.";
  } else if (projectReady && runtimeReady) {
    headline = "You're ready to explore";
    subhead = isSampleProject
      ? "Run the sample query, then open Result Graph and Figure."
      : "Run Cypher, analyst verbs, and browse ontology from the GraphForge sidebar.";
  } else if (!runtimeReady) {
    subhead = "Link a Node or Python runtime to begin. Full diagnostics are in Check Environment.";
  } else if (!projectReady) {
    subhead = "Runtime is ready — open a project or try the sample next.";
  }
  if (page === "query") {
    headline = "Query";
    subhead = projectReady
      ? "Draft Cypher, save reusable project templates, and reopen result history."
      : "Open a project to draft, save, and run query templates.";
  } else if (page === "visualize") {
    headline = "Visualize";
    subhead = projectReady
      ? "Create saved graph or figure views from durable project results."
      : "Open a project and run a query before creating a visualization.";
  }

  return {
    screen,
    headline,
    subhead,
    steps,
    mode,
    layout: workspace.layout,
    starter: workspace.starter,
    controls: workspace.controls,
    artifacts,
    page,
  };
}
