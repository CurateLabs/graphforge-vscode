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
| **Setup / control hub** | **Get Started** walks new users through runtime → project → query, then provides **Hub / Query / Visualize** pages. Queries, results, bindings, filters, renderer/layout, map, and time settings are files in the open project. |
| **Cypher** | `.cypher` / `.cql` language support with syntax highlighting, plus **Run Query** (and **Run Query with Parameters…**). |
| **Analyst verbs** | Rank, Cluster, Paths, Analyze, Similar, Find — QuickPick-driven, each with an **Advanced…** variant for optional parameters. |
| **Projects** | An Activity Bar explorer that lists folders containing a valid GraphForge `FORMAT` marker. |
| **Ontology** | A mode badge (exploratory/advisory/strict) plus an entity/relation tree and an Ontology Viewer webview, including a **Load Ontology…** action. |
| **Knowledge** | List, inspect, and create knowledge-ledger assertions, with Advanced commands for attaching evidence, assessing confidence, and recording status. |
| **Results** | A tabular `WebviewView` in VS Code's bottom Panel. Scalar values stay compact, nested values expand as JSON, and row/cell selections highlight matching nodes or edges in an open Result Graph. |
| **Result Graph** | AntV G6 Canvas is the current creation default; Cytoscape Canvas and Sigma WebGL remain explicit adapters. Saved renderer/layout/style choices remain authoritative on reopen. |
| **Charts, maps, and timelines** | AntV G2 charts and timelines plus L7 geospatial views from explicit v2 artifacts, with Save/Revert and an accessible filtered-data companion. |
| **Plotly Figure** | Retained raw Plotly interchange and v1/explicit-v2 adapter (`showFigure` / `figureFromResult`); not a hidden replacement for saved G2 work. |

## Project workbench files

GraphForge keeps durable exploration state with the project:

- `queries/` — editable `.cypher` queries
- `results/` — latest JSON/Markdown plus timestamped result history
- `visualizations/` — strict v2 graph/chart/geospatial/temporal `.gfviz.json`
  specs plus readable, unchanged v1 Cytoscape/Sigma/Plotly specs
- `mutations/` and `data/` — project-backed graph changes and source material

The air-routes starter uses this same layout; its query and visualization
settings are sample files, not hidden extension presets. Global G6/G2 settings
choose only the next artifact template; saved files explicitly own behavior.
Invalid or unsupported configuration fails visibly without field inference,
renderer substitution, or network fallback.

## Two runtimes, one extension

The extension can execute Cypher and analyst verbs through either engine binding — a native
`@curatelabs/graphforge` addon, or the `graphforge` Python package — and picks sensibly between them
by default. See [`install.md`](install.md) for the full setup and selection story.

## License

Apache-2.0 © Curate Labs Inc.
