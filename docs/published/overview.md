# Overview

**GraphForge for VS Code** (`CurateLabsAI.graphforge`) brings [GraphForge](https://docs.graphforge.sh/)
projects into the editor: an openCypher query surface, a set of analyst verbs (Rank, Cluster,
Paths, Analyze, Similar, Find), a progressive ontology viewer, and an epistemic-aware result
graph.

## Who it's for

- Analysts and engineers who already have (or are building) a GraphForge project and want to
  query and explore it without leaving VS Code.
- Python-first analysts working out of a `pyproject.toml`/`uv`-managed project or a
  notebook-heavy workspace — the extension runs the same commands against the `graphforge`
  PyPI package, not just the native Node binding.
- Coding agents (Cursor, GitHub Copilot Agent Mode, or similar) driving the extension
  end-to-end via stable `vscode.commands.executeCommand` IDs — see
  [`agent-interop.md`](agent-interop.md).

## What you get

| Surface | What it does |
|---|---|
| **Setup / control hub** | **Get Started** walks new users through runtime → project → query, then provides **Hub / Query / Visualize** pages. Queries, result history, visualization specs, filters, and renderer/chart settings are files in the open project. |
| **Cypher** | `.cypher` / `.cql` language support with syntax highlighting, plus **Run Query** (and **Run Query with Parameters…**). |
| **Analyst verbs** | Rank, Cluster, Paths, Analyze, Similar, Find — QuickPick-driven, each with an **Advanced…** variant for optional parameters. |
| **Projects** | An Activity Bar explorer that lists folders containing a valid GraphForge `FORMAT` marker. |
| **Ontology** | A mode badge (exploratory/advisory/strict) plus an entity/relation tree and an Ontology Viewer webview, including a **Load Ontology…** action. |
| **Knowledge** | List, inspect, and create knowledge-ledger assertions, with Advanced commands for attaching evidence, assessing confidence, and recording status. |
| **Results** | A tabular `WebviewView` in VS Code's bottom Panel. Scalar values stay compact, nested values expand as JSON, and row/cell selections highlight matching nodes or edges in an open Result Graph. |
| **Result Graph** | An interactive Cytoscape (default) or Sigma graph with force layout, pan/zoom/fit, node/edge inspection, and class or epistemic styling. Switch renderers in GraphForge Settings without reloading the extension. |
| **Figure** | A Plotly chart panel for analytical figures (`showFigure` / `figureFromResult`) — separate from Result Graph. |

## Project workbench files

GraphForge keeps durable exploration state with the project:

- `queries/` — editable `.cypher` queries
- `results/` — latest JSON/Markdown plus timestamped result history
- `visualizations/` — saved Result Graph or Plotly `.gfviz.json` specs
- `mutations/` and `data/` — project-backed graph changes and source material

The air-routes starter uses this same layout; its query and visualization
settings are sample files, not hidden extension presets.

## Two runtimes, one extension

The extension can execute Cypher and analyst verbs through either engine binding — a native
`@curatelabs/graphforge` addon, or the `graphforge` Python package — and picks sensibly between them
by default. See [`install.md`](install.md) for the full setup and selection story.

## License

Apache-2.0 © Curate Labs Inc.
