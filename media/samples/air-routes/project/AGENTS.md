# GraphForge project contract for coding agents

This folder is a `graphforge-project/v1` project. Treat `FORMAT` as the project
marker and keep generated work inside the project.

## Read and write these artifacts

- `queries/**/*.cypher` or `.cql` — executable openCypher text.
- `queries/**/*.json` — `{ "cypher": "...", "params": { ... } }`.
- `results/*.json` — `{ "columns": ["..."], "rows": [{ ... }], "rowCount": 0 }`.
  `results/query-result.json` is the canonical latest result; timestamped files
  are history.
- `visualizations/*.gfviz.json` — `graphforge.visualization/v1` specs. A spec
  has `kind: "result-graph"` or `"plotly"` and references a result path.
- `mutations/**/*.cypher`, `.cql`, or `.json` — writes that require explicit
  confirmation before execution.

Paths may be project-relative or absolute, but GraphForge rejects paths outside
this project.

## Operate without webview clicks

Call VS Code commands through `vscode.commands.executeCommand`:

1. `graphforge.agent.getContext()` — runtime, project marker, effective
   settings, absolute artifact paths, last-result paths, and the compact
   command contract.
2. `graphforge.runProjectQuery({ path, resultName? })`.
3. `graphforge.openProjectResult({ path })`.
4. `graphforge.openProjectVisualization({ path })`.
5. `graphforge.applyProjectMutation({ path, confirm: true })` only after
   reviewing the mutation file.

For this sample, start with
`queries/templates/routes-overview.cypher`, then open either saved visualization
under `visualizations/`.
