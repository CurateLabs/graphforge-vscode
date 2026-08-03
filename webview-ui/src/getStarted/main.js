import "./getStarted.css";

const app = document.getElementById("app");
if (!app) throw new Error("GraphForge Get Started root is missing.");
const logoUri = app.dataset.logoUri || "";
document.body.innerHTML = `
  <div class="header">
<img class="logo" src="${logoUri}" alt="" />
<h1 id="headline">Build your first graph view</h1>
<p class="subhead" id="subhead"></p>
  </div>
  <div id="hub-page" class="page">
<section id="ready-summary" class="ready-summary" hidden>
  <p class="ready-kicker">Project ready</p>
  <p class="ready-copy">Open any saved view. The map leads because it explains this dataset fastest; the force-directed graphs remain available.</p>
  <label>Saved view<select id="hub-visualization"></select></label>
  <button class="primary full" type="button" id="open-hub-visualization">Open selected view</button>
  <div class="actions compact-actions">
    <button class="secondary" type="button" id="open-hub-result">Inspect result</button>
    <button class="secondary" type="button" id="open-hub-notebook">Open Python notebook</button>
  </div>
</section>
<details id="journey-details" class="journey-details" open>
  <summary id="journey-status" role="status" aria-live="polite">Setup path</summary>
  <ol id="steps" class="journey-list" aria-label="Shortest path to saved project views"></ol>
</details>
  </div>
  <div id="query-page" class="page" hidden>
<p class="section-label">Draft query</p>
<form id="query-form" class="form">
  <label>Cypher<textarea id="query-cypher" required placeholder="MATCH (n) RETURN n LIMIT 25"></textarea></label>
  <details class="optional-section">
    <summary>Naming</summary>
    <label>Template name (optional)<input id="query-name" placeholder="query-YYYYMMDD-HHMMSS-mmm" /></label>
    <label>Result name (optional)<input id="result-name" placeholder="results-YYYYMMDD-HHMMSS-mmm" /></label>
  </details>
  <button class="primary full" type="submit">Save &amp; run</button>
  <details class="optional-section">
    <summary>Other query actions</summary>
    <div class="actions">
      <button class="secondary" type="button" id="run-query">Run without saving</button>
      <button class="secondary" type="button" id="save-template">Save without running</button>
    </div>
  </details>
</form>
<details class="artifact-section" open><summary>Query templates</summary><div id="template-list" class="artifact-list"></div></details>
<details class="artifact-section"><summary>Project queries</summary><div id="query-list" class="artifact-list"></div></details>
<details class="artifact-section" open><summary>Result history</summary><div id="result-list" class="artifact-list"></div></details>
  </div>
  <div id="visualize-page" class="page" hidden>
<p class="section-label">Create visualization</p>
<form id="visualization-form" class="form">
  <label>Result file<select id="viz-result" required></select></label>
  <label>View type<select id="viz-kind">
    <option value="result-graph">Result Graph</option>
    <option value="chart">Analytical chart</option>
    <option value="geospatial">Geospatial map</option>
    <option value="temporal">Temporal chart</option>
  </select></label>
  <div id="graph-settings">
    <label>Renderer<select id="viz-renderer"><option value="">Cytoscape (default)</option><option value="cytoscape">Cytoscape</option><option value="g6">AntV G6</option><option value="sigma">Sigma</option></select></label>
  </div>
  <div id="chart-settings" hidden>
    <label>Renderer<select id="viz-chart-renderer"><option value="">Plotly (default)</option><option value="plotly">Plotly</option><option value="g2">AntV G2</option></select></label>
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
      <label>Source longitude<select id="viz-longitude"></select></label>
      <label>Source latitude<select id="viz-latitude"></select></label>
    </div>
    <div class="form-row">
      <label>Target longitude (optional)<select id="viz-target-longitude"></select></label>
      <label>Target latitude (optional)<select id="viz-target-latitude"></select></label>
    </div>
    <p class="muted">Choose both target fields to draw explicit L7 arcs between source and target points. Coordinates remain EPSG:4326 on an offline blank map.</p>
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
  <details class="optional-section">
    <summary>Naming and filter</summary>
    <label>Name (optional)<input id="viz-name" placeholder="vis-YYYYMMDD-HHMMSS-mmm" /></label>
    <div class="form-row">
      <label>Filter column<select id="viz-filter-column"></select></label>
      <label>Filter mode<select id="viz-filter-operator"><option value="equals">equals</option><option value="contains">contains</option></select></label>
    </div>
    <label>Filter value (optional)<input id="viz-filter-value" /></label>
  </details>
  <button class="primary full" type="submit">Save &amp; open</button>
</form>
<details class="artifact-section" open><summary>Saved visualizations</summary><div id="visualization-list" class="artifact-list"></div></details>
  </div>
  <div class="footer">
<button class="link" id="refresh">Check Environment</button>
<button class="link" id="open-settings">Settings</button>
  </div>
  <p id="action-status" class="action-status" role="status" aria-live="polite" hidden></p>
`;

const vscode = acquireVsCodeApi();
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
    actions.map((action) => actionButton(
      action.primary ? 'primary' : 'secondary',
      action.disabled ? action : { ...action, args: [{ path: item.path }] },
    )).join('') + '</div></div>';
}

function renderArtifacts(artifacts) {
  const queries = artifacts?.queries || [];
  const templates = artifacts?.queryTemplates || [];
  const results = artifacts?.results || [];
  const visualizations = artifacts?.visualizations || [];
  const availableResults = new Set(results.map((item) => item.path));
  const visualizationPriority = (item) => {
    if (item.kind === 'geospatial') return 0;
    if (item.kind === 'result-graph' && item.renderer === 'cytoscape') return 1;
    if (item.kind === 'result-graph') return 2;
    if (item.kind === 'plotly') return 3;
    if (item.kind === 'chart') return 4;
    if (item.kind === 'temporal') return 5;
    return 6;
  };
  const readyVisualizations = visualizations
    .filter((item) => availableResults.has(item.result))
    .slice()
    .sort((left, right) =>
      visualizationPriority(left) - visualizationPriority(right) ||
      left.name.localeCompare(right.name)
    );
  const hubVisualization = byId('hub-visualization');
  const previousHubPath = hubVisualization.value;
  hubVisualization.innerHTML = readyVisualizations.map((item) =>
    '<option value="' + escapeHtml(item.path) + '">' +
      escapeHtml(item.name + ' — ' + item.kind + ' · ' + item.renderer) +
    '</option>'
  ).join('');
  if (readyVisualizations.some((item) => item.path === previousHubPath)) {
    hubVisualization.value = previousHubPath;
  }
  byId('open-hub-visualization').disabled = readyVisualizations.length === 0;
  const notebookAvailable = (artifacts?.notebooks || []).length > 0;
  byId('open-hub-notebook').hidden = !notebookAvailable;
  byId('open-hub-result').disabled = results.length === 0;
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
    ? visualizations.map((item) => {
        const sourceReady = availableResults.has(item.result);
        return artifactRow(item, [
          sourceReady
            ? { label: 'Open', command: 'graphforge.openProjectVisualization', primary: true }
            : { label: 'Needs result', disabled: 'Run the visualization source query first.', primary: true },
          { label: 'JSON', command: 'graphforge.openProjectArtifact' },
        ], item.kind + ' · ' + item.renderer + ' · ' + item.result + (sourceReady ? '' : ' · source result missing'));
      }).join('')
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
  ['viz-x', 'viz-y', 'viz-color', 'viz-longitude', 'viz-latitude', 'viz-target-longitude', 'viz-target-latitude', 'viz-timestamp', 'viz-temporal-value', 'viz-temporal-series', 'viz-filter-column'].forEach((id) => {
    const select = byId(id);
    const old = select.value;
    const empty = id === 'viz-color' || id === 'viz-target-longitude' || id === 'viz-target-latitude' || id === 'viz-temporal-series' || id === 'viz-filter-column'
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
    renderer: byId('viz-renderer').value || undefined,
  } : kind === 'chart' ? {
    ...common,
    renderer: byId('viz-chart-renderer').value || undefined,
    mark: byId('viz-chart-type').value,
    x: byId('viz-x').value,
    y: byId('viz-chart-type').value === 'histogram' ? undefined : byId('viz-y').value,
    color: byId('viz-color').value || undefined,
  } : kind === 'geospatial' ? {
    ...common,
    renderer: 'l7',
    longitude: byId('viz-longitude').value,
    latitude: byId('viz-latitude').value,
    targetLongitude: byId('viz-target-longitude').value || undefined,
    targetLatitude: byId('viz-target-latitude').value || undefined,
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

byId('open-hub-visualization').addEventListener('click', () => {
  const selected = currentState?.artifacts?.visualizations?.find(
    (item) => item.path === byId('hub-visualization').value,
  );
  if (!selected) return;
  runCommand('graphforge.openProjectVisualization', {
    path: selected.path,
    ...(selected.kind === 'result-graph' ? { waitForReady: true, timeoutMs: 60000 } : {}),
  });
});
byId('open-hub-result').addEventListener('click', () => {
  const results = currentState?.artifacts?.results || [];
  const result = results.find((item) => item.path === 'results/query-result.json') || results[0];
  if (result) runCommand('graphforge.openProjectResult', { path: result.path });
});
byId('open-hub-notebook').addEventListener('click', () =>
  runCommand('graphforge.openSampleNotebook')
);

document.getElementById('refresh').addEventListener('click', () =>
  vscode.postMessage({ type: 'graphforge/runCommand', command: 'graphforge.checkEnvironment' })
);
document.getElementById('open-settings').addEventListener('click', () =>
  vscode.postMessage({ type: 'graphforge/runCommand', command: 'graphforge.openSettings' })
);

function actionButton(cls, action) {
  if (action.disabled) {
    return '<button class="' + cls + '" disabled title="' + escapeHtml(action.disabled) + '">' +
      escapeHtml(action.label) + '</button>';
  }
  const argsAttr = action.args
    ? ' data-args="' + encodeURIComponent(JSON.stringify(action.args)) + '"'
    : '';
  return '<button class="' + cls + '" data-cmd="' + action.command + '"' + argsAttr + '>' +
    escapeHtml(action.label) + '</button>';
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
      const status = byId('action-status');
      status.hidden = false;
      status.className = 'action-status working';
      status.textContent = btn.textContent.trim() + '…';
    });
  });
}

function renderSteps(steps) {
  const stepsEl = document.getElementById('steps');
  const doneCount = steps.filter((step) => step.status === 'done').length;
  const current = steps.find((step) => step.status === 'current');
  const complete = steps.length > 0 && doneCount === steps.length;
  byId('ready-summary').hidden = !complete;
  byId('journey-details').open = !complete;
  byId('journey-status').textContent = current
    ? 'Shortest path · ' + doneCount + ' of ' + steps.length + ' complete'
    : 'Setup path · ' + doneCount + ' of ' + steps.length + ' complete';
  stepsEl.innerHTML = steps.map((step, i) => {
    const actions = [];
    if (step.primaryAction) {
      actions.push(actionButton('primary', step.primaryAction));
    }
    if (step.secondaryAction) {
      actions.push(actionButton('secondary', step.secondaryAction));
    }
    const currentAttr = step.status === 'current' ? ' aria-current="step"' : '';
    const artifact = step.artifact
      ? '<span class="step-artifact">' + escapeHtml(step.artifact) + '</span>'
      : '';
    return '<li class="journey-step ' + step.status + '"' + currentAttr + '>' +
      '<div class="journey-node" aria-hidden="true">' + (i + 1) + '</div>' +
      '<div class="journey-content">' +
        '<span class="sr-only">' + escapeHtml(step.status) + ': </span>' +
        '<p class="step-title">' + escapeHtml(step.title) + '</p>' +
        '<p class="step-detail">' + escapeHtml(step.detail) + artifact + '</p>' +
        (actions.length ? '<div class="actions">' + actions.join('') + '</div>' : '') +
      '</div>' +
    '</li>';
  }).join('');
  bindActions(stepsEl);
}

function render(state) {
  currentState = state;
  document.getElementById('headline').textContent = state.headline;
  document.getElementById('subhead').textContent = state.subhead;
  const page = state.page || 'hub';
  ['hub', 'query', 'visualize'].forEach((name) => {
    byId(name + '-page').hidden = name !== page;
  });
  renderArtifacts(state.artifacts);
  renderSteps(state.steps || []);
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg && msg.type === 'graphforge/getStarted') render(msg.state);
  if (msg && msg.type === 'graphforge/commandStatus') {
    const status = byId('action-status');
    status.hidden = false;
    status.className = 'action-status ' + msg.status;
    status.textContent = msg.status === 'error' ? 'Could not complete action: ' + msg.message : msg.message;
  }
});
vscode.postMessage({ type: 'graphforge/ready' });
