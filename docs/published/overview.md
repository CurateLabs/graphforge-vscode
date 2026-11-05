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
| **Setup / journey map** | **Get Started** keeps Environment → Project → Query → Result → Visualize visible and highlights the simplest next action. **Home / Query / Visualize** pages remain available, while queries, notebooks, results, bindings, filters, renderer/layout, map, and time settings stay as files in the open project. |
| **Cypher** | `.cypher` / `.cql` language support with syntax highlighting, plus **Run Query** (and **Run Query with Parameters…**). |
| **Analyst verbs** | Rank, Cluster, Paths, Analyze, Similar, Find — QuickPick-driven, each with an **Advanced…** variant for optional parameters. |
| **Projects** | An Activity Bar explorer that lists folders containing a valid GraphForge `FORMAT` marker. |
| **Ontology** | A mode badge (exploratory/advisory/strict) plus an entity/relation tree and an Ontology Viewer webview, including a **Load Ontology…** action. |
| **Knowledge** | List, inspect, and create knowledge-ledger assertions, with Advanced commands for attaching evidence, assessing confidence, and recording status. |
| **Results** | A tabular `WebviewView` in VS Code's bottom Panel. Scalar values stay compact, nested values expand as JSON, and row/cell selections highlight matching nodes or edges in an open Result Graph. |
| **XYG visualization** | Graphs, charts, maps and timelines with native composition, canonical UUID picks and PNG/SVG export |

## Project workbench files

Queries, source data, Python notebooks/apps, durable JSON/Markdown plus original
Arrow results, and `xyg.intent/v1` visualizations live in the open project.
The air-routes sample contains four XYG views over 586 airports/7,430 routes.
The route graph contains 579 connected airports; the timeline is illustrative.

XYG owns composition, layout, ticks, painting and PNG/SVG export. The editor
owns explicit bindings, project paths and view lifecycle. Unsupported data or
intent fails visibly. See [XYG integration](../engineering/XYG.md).

## Two runtimes, one extension

The extension can execute Cypher and analyst verbs through either engine binding — a native
`@curatelabs/graphforge` addon, or the `graphforge` Python package — and picks sensibly between them
by default. See [`install.md`](install.md) for the full setup and selection story.

## License

Apache-2.0 © Curate Labs Inc.
