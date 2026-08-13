# GraphForge project contract for coding agents

This folder is a `graphforge-project/v1` project. Treat `FORMAT` as the project
marker and keep generated work inside the project.

## Read and write these artifacts

- `queries/**/*.cypher` or `.cql` — executable openCypher text.
- `queries/**/*.json` — `{ "cypher": "...", "params": { ... } }`.
- `results/*.json` — `{ "columns": ["..."], "rows": [{ ... }], "rowCount": 0 }`.
  `results/query-result.json` is the canonical latest result; timestamped files
  are history.
- `visualizations/*.gfviz.json` — new work uses strict
  `graphforge.visualization/v2` with kind `result-graph`, `chart`, `geospatial`,
  or `temporal`. V2 records renderer/backend, filters, explicit field bindings,
  layout or coordinate/time settings, and presentation. Existing v1
  Cytoscape/Sigma/Plotly specs remain readable and are not rewritten on open.
- `mutations/**/*.cypher`, `.cql`, or `.json` — writes that require explicit
  confirmation before execution.
- `notebooks/air-routes-analysis.ipynb` — a visible Python/Jupyter path over the
  same copied CSVs. It uses the Python binding directly and writes portable CSV
  and self-contained Plotly HTML under `notebooks/outputs/`.
- `apps/air_routes_dashboard.py` — a portable Python/Streamlit dashboard over
  the same CSVs. Run `uv run --with streamlit --with graphforge --with pandas
  --with plotly streamlit run apps/air_routes_dashboard.py` from the project
  root to serve it in a browser.

Paths may be project-relative or absolute, but GraphForge rejects paths outside
this project. The agent artifact index exposes the notebook and Streamlit app
with absolute paths under `artifacts.notebooks` and `artifacts.apps`.

## Operate without webview clicks

Call VS Code commands through `vscode.commands.executeCommand`:

1. `graphforge.agent.getContext()` — runtime, project marker, effective
   settings, absolute artifact paths, last-result paths, and the compact
   command contract.
2. `graphforge.runProjectQuery({ path, resultName? })`.
3. `graphforge.openProjectResult({ path })`.
4. `graphforge.openProjectVisualization({ path, waitForReady?: true, timeoutMs?: 30000 })`;
   an explicit readiness wait returns the terminal renderer lifecycle.
5. `graphforge.createProjectVisualization({ result, kind, ...explicitBindings })`
   saves a v2 artifact before opening and returns `{ path, spec, panel? }`.
6. `graphforge.applyProjectMutation({ path, confirm: true })` only after
   reviewing the mutation file.

For this sample, start with
`queries/templates/routes-overview.cypher`, then open the saved Cytoscape graph.
For the analyst-owned Python paths, open `notebooks/air-routes-analysis.ipynb`
and select a kernel with GraphForge/pandas/Plotly, or run
`apps/air_routes_dashboard.py` with its documented `uv run` command. Neither
path relies on VS Code results or visualization fixtures.
The explicit G6 graph, G2 chart, L7 map, and G2 timeline remain available under
`visualizations/`. The v1 files beside them prove the retained compatibility
path. Do not infer missing fields or silently switch renderer, layout,
projection, timezone, or data source; fix the artifact instead.
