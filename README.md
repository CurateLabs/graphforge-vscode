# GraphForge for VS Code

Explore [GraphForge](https://docs.graphforge.sh/) projects in the editor: Cypher, analyst verbs, progressive ontology, and epistemic-aware result graphs.

Publisher: **CurateLabs** (`CurateLabs.graphforge`).

## Features (scaffold)

| Surface | What you get |
|---|---|
| **Setup** | Check Environment, Setup Native Binding, Initialize Project Here — palette-first, never a dead end |
| **Cypher** | `.cypher` / `.cql` language id + TextMate highlighting + **Run Query** (+ Advanced: Run Query with Parameters…) |
| **Analyst verbs** | Rank, Cluster, Paths, Analyze, Similar, Find (QuickPick → engine) |
| **Projects** | Activity-bar explorer for folders with a valid `FORMAT` marker |
| **Ontology** | Mode + entity/relation tree; Ontology Viewer webview |
| **Knowledge** | Ledger summary + hooks for epistemic status |
| **Result Graph** | Webview shell: nodes/edges styled by class + epistemic status |

## Develop

```bash
npm install
npm run compile
```

Press **F5** (`Run Extension`) to open an Extension Development Host.

### Native binding (`@graphforge/node`)

The extension calls the GraphForge Node addon for Cypher and analyst verbs. The package is an **optional peer dependency**.

Link a local build from the engine monorepo:

```bash
# in graphforge/
# build the napi package (see crates/gf-bindings-node)
cd crates/gf-bindings-node && npm run build

# in graphforge-vscode/
npm install ../graphforge/crates/gf-bindings-node
```

Or set `graphforge.nativeModulePath` to the absolute path of a built `@graphforge/node` package directory.

Without the binding, commands and trees still register; open/query paths fail closed with a status-bar message.

Prefer the guided path: run **GraphForge: Setup Native Binding** from the palette. It offers up to three choices in one QuickPick — link a detected sibling engine build, browse to a built `@graphforge/node` folder (sets `graphforge.nativeModulePath`), or run `npm install @graphforge/node` in a terminal once it's published. Setup takes effect immediately; no window reload needed.

### Project detection

A folder is a GraphForge project only when it contains a `FORMAT` file whose exact contents are:

```text
graphforge-project/v1
```

(including the trailing newline). Never inferred from Parquet alone.

No project yet? Run **GraphForge: Initialize Project Here** — it picks the current workspace folder or a folder you choose, confirms once, and lets the engine's own `open_or_initialize_project` contract create the first generation. It only ever succeeds on an empty or already-initializing directory; anything else fails closed with the engine's error code instead of touching foreign files.

## Setup UX (start here)

Run **GraphForge: Check Environment** any time to see where things stand — a 3-line human summary (binding, project, next step) plus a JSON details document with the same fields (`binding`, `project`, `nextAction`) for agents or scripts to consume. Every other command that needs a binding or project routes failures back through this flow instead of dead-ending:

| Situation | What to run | What happens |
|---|---|---|
| No `@graphforge/node` anywhere | `GraphForge: Setup Native Binding` | One QuickPick, ≤3 choices: link sibling build, browse for a folder, or `npm install` |
| Binding ok, no FORMAT project open | `GraphForge: Initialize Project Here` or `GraphForge: Open Project` | Initialize a new folder, or open an existing project |
| Anything unclear | `GraphForge: Check Environment` | Human summary + agent-copyable JSON |

## Commands

- `GraphForge: Check Environment`
- `GraphForge: Setup Native Binding`
- `GraphForge: Initialize Project Here`
- `GraphForge: Open Project`
- `GraphForge: Run Query` — selection → whole file → single input box; opens a structured `{ columns, rows, rowCount }` results document and reports row count
- `GraphForge: Run Query with Parameters…` — Advanced: same input resolution, plus a JSON parameters prompt
- `GraphForge: Rank` / `Cluster` / `Paths` / `Analyze` / `Similar` / `Find`
- `GraphForge: Show Ontology Viewer`
- `GraphForge: Show Result Graph`
- `GraphForge: Show Project Capabilities`
- `GraphForge: Load Ontology…`

## License

Apache-2.0 © Curate Labs Inc.
