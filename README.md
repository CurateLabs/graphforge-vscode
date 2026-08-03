# GraphForge for VS Code

Explore [GraphForge](https://docs.graphforge.sh/) projects in the editor: Cypher, analyst verbs, progressive ontology, and epistemic-aware result graphs.

Publisher: **CurateLabsAI** (`CurateLabsAI.graphforge`).

## Features

| Surface | What you get |
|---|---|
| **Setup** | Check Environment, Setup Native Binding, Initialize Project Here — palette-first, never a dead end |
| **Cypher** | `.cypher` / `.cql` language id + TextMate highlighting + **Run Query** (+ Advanced: Run Query with Parameters…) |
| **Analyst verbs** | Rank, Cluster, Paths, Analyze, Similar, Find (QuickPick → engine; all except Find have an Advanced… variant for optional params) |
| **Projects** | Activity-bar explorer for folders with a valid `FORMAT` marker |
| **Ontology** | Mode badge + entity/relation tree; Ontology Viewer webview with a helpful exploratory empty state, **Load Ontology…**, and an Advanced section (open `ontology.json`, explain mode) |
| **Knowledge** | Inspect and create assertions: list/empty states, **Create Assertion…** (minimal fields), **Show Assertion** / **Show on Graph**, plus Advanced attach-evidence / assess-confidence / record-status commands |
| **Result Graph** | AntV G6 Canvas by default, with retained Cytoscape and Sigma adapters; explicit artifact-owned layout, styling, interactions, and optional time configuration |
| **Charts, maps, and timelines** | AntV G2 analytical/temporal charts and L7 geospatial views from saved project artifacts; retained Plotly figure and v1 artifact compatibility |
| **Results** | Interactive table in the bottom Panel; expandable nested JSON and row/cell selection linked to matching Result Graph nodes/edges |
| **Modules** | One Module Bay for default, non-removable Query/Visualize/Import modules, future GraphForge-catalog modules, and advanced side-loads |

## Requirements

- VS Code `^1.96.0`
- One GraphForge engine runtime, either:
  - **Node** — a built `@curatelabs/graphforge` package (optional peer dependency), or
  - **Python** — a `graphforge` (PyPI) install in an interpreter VS Code can see, plus [`uv`](https://docs.astral.sh/uv/) for setup (never `pip`)
- No runtime yet? Run **`GraphForge: Check Environment`** after installing — it always tells you what to run next.

## Develop

```bash
npm install
npm run compile
```

Press **F5** (`Run Extension`) to open an Extension Development Host.

For one-off renderer-adapter evidence, run
`npm run benchmark:visualizations -- --layout-tier all --output /tmp/graphforge-viz.json`.
It uses the same small, real-sample medium, and generated large graph tiers for
G6, Cytoscape, and Sigma. Layouts run in isolated Node workers with an explicit
60-second per-layout evidence budget. This is opt-in and does not claim browser
paint, interaction, accessibility, or peak-memory performance; it is intentionally
absent from CI and release gates.

### Runtimes: Node (default) and Python (alternative)

The extension can run Cypher and analyst verbs through either engine binding:

- **Node (`@curatelabs/graphforge`)** — the default. Fast, in-process, no subprocess.
- **Python (`graphforge` on PyPI)** — a first-class alternative for analysts already living in
  a Python/notebook workflow, or when a native Node binding isn't available for your platform.

Which one is used is controlled by `graphforge.runtime` (`auto` | `node` | `python`, default
`auto`). In `auto`, **Node is the global default** — except when the workspace looks like a
**Python project** (and not primarily a Node project), in which case `auto` prefers Python even
if `@curatelabs/graphforge` is also available:

- **Python signals:** `pyproject.toml`, `requirements.txt`, `uv.lock`, `.python-version`,
  `Pipfile`, `environment.yml`, `setup.py`, a notebook-dominant workspace root, or an explicitly
  selected VS Code Python interpreter.
- **Node signals:** a `package.json` at the workspace root (whether or not it depends on
  `@curatelabs/graphforge`).
- **If both are present:** Python wins only on a *strong* signal — `pyproject.toml`/`uv.lock`
  present, or a Python `graphforge` environment already usable. Otherwise the workspace is
  ambiguous and Node stays the default, per the rule that "Node remains the global default only
  when the repo is Node-ish or ambiguous."
- Set `graphforge.runtime` to `node` or `python` explicitly to bypass this detection entirely —
  an explicit preference never falls back to the other runtime, regardless of project kind.

Run **`GraphForge: Check Environment`** any time to see both runtimes' status, which one is
active, and the single next step to fix whichever is missing.

#### Node binding (`@curatelabs/graphforge`)

The package is an **optional peer dependency**. Link a local build from the engine monorepo:

```bash
# in graphforge/
# build the napi package (see crates/graphforge-bindings-node)
cd crates/graphforge-bindings-node && npm run build

# in graphforge-vscode/
npm install ../graphforge/crates/graphforge-bindings-node
```

Or run **`GraphForge: Setup Native Binding`**, or set `graphforge.nativeModulePath` to the
absolute path of a built `@curatelabs/graphforge` package directory.

#### Python binding (`graphforge`)

**Package manager policy: [`uv`](https://docs.astral.sh/uv/) only — never `pip`.** All setup UX,
docs, and tests here use `uv`. If `uv` isn't installed, [install it
first](https://docs.astral.sh/uv/getting-started/installation/); GraphForge will not fall back to
`pip install`.

```bash
# in a uv-managed project (has pyproject.toml / uv.lock)
uv add graphforge

# targeting an arbitrary interpreter/venv instead
uv pip install --python /path/to/python graphforge
```

Run **`GraphForge: Setup Python Binding`** — a single QuickPick with up to three choices:

1. **Use detected interpreter** — the extension looks for, in order: an explicit
   `graphforge.pythonInterpreterPath`, the interpreter currently selected in the
   [Python extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python),
   a workspace `.venv`/`venv`/`env` folder, then `python3`/`python` on `PATH`.
2. **Select interpreter…** — browse for a specific `python`/`python3` executable; this sets
   `graphforge.pythonInterpreterPath`.
3. **uv add graphforge / uv pip install graphforge** — runs `uv add graphforge` when the workspace
   is a uv-managed project (`pyproject.toml`/`uv.lock` present), otherwise `uv pip install
   --python <interpreter> graphforge`, in a terminal, only after you explicitly confirm (this
   makes a network request). If `uv` itself isn't installed, the command stops and tells you to
   install uv — it never falls back to `pip`.

Under the hood, a small bundled script (`python/graphforge_host.py`) is spawned once per open
project as a long-lived subprocess and speaks newline-delimited JSON over stdin/stdout — every
request is a thin marshal straight to a `graphforge.GraphForge` method call (no engine semantics
are reimplemented in the extension), and table results come back as Arrow IPC, decoded by the
same `apache-arrow` path used for the Node binding. See
[`docs/engineering/ARCHITECTURE.md`](docs/engineering/ARCHITECTURE.md) for the full protocol.

Requires the [`pyarrow`](https://pypi.org/project/pyarrow/) package alongside `graphforge` in
the selected interpreter (installed automatically as a `graphforge` dependency in most setups).

#### Neither runtime available?

Commands and trees still register; open/query paths fail closed with a status-bar message and an
error toast that offers both **Setup Native Binding** and **Setup Python Binding**.

Prefer the guided path: run **GraphForge: Setup Native Binding** from the palette. It offers up to three choices in one QuickPick — link a detected sibling engine build, browse to a built `@curatelabs/graphforge` folder (sets `graphforge.nativeModulePath`), or run `npm install @curatelabs/graphforge` in a terminal. Setup takes effect immediately; no window reload needed.

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
| No `@curatelabs/graphforge` anywhere | `GraphForge: Setup Native Binding` | One QuickPick, ≤3 choices: link sibling build, browse for a folder, or `npm install` |
| Binding ok, no FORMAT project open | `GraphForge: Initialize Project Here` or `GraphForge: Open Project` | Initialize a new folder, or open an existing project |
| Anything unclear | `GraphForge: Check Environment` | Human summary + agent-copyable JSON |

## Commands

- **Modules** — `Manage Modules`, `Install Module from File…`, `Refresh Modules`; default Query, Visualize, and Import use the same install/enable lifecycle as catalog entries and side-loads
- **Import** — `Import Data…` (`graphforge.importData`) for CSV, JSON, JSON Lines, and NDJSON node records; agents pass `{ path, label, mode?, idColumn?, confirm: true }`
- **Setup** — `GraphForge: Check Environment` (`graphforge.checkEnvironment`, accepts optional `{ silent: true }`, always returns the `EnvironmentReport` JSON from `executeCommand`), `Setup Native Binding`, `Setup Python Binding`, `Initialize Project Here`, `Open Project` (`graphforge.openProject`, accepts an optional folder-path string arg to skip the picker), `Refresh Explorer`
- **Cypher** — `Run Query` (`graphforge.runQuery`: selection → whole file → single input box, or pass `{ cypher, params? }` to skip both; writes canonical JSON/Markdown plus timestamped history under `results/`, reveals the interactive table in the bottom Panel, and returns `{ columns, rows, rowCount }`), `Run Project Query` (`{ path }`), `Run Query with Parameters…`
- **Analyst verbs** — `Rank` / `Cluster` / `Paths` / `Analyze` / `Similar` / `Find` (all except Find have an `…Advanced…` command for optional parameters) — QuickPick-driven today; each returns its result JSON (or `{ error }` / `{ cancelled: true }`) from `executeCommand`
- **Indexing** *(Node-only)* — `Index Text…`, `Index Vector…`, `Inspect Text Index…`, `Index Adjacency`, `Inspect Adjacency Index`, `Rebuild Adjacency Index`
- **Checkpoints** *(Node-only)* — `Create Checkpoint…`, `List Checkpoints`, `Open Checkpoint…`, `Diff Checkpoints…`, `Delete Checkpoint…`, `Revert to Checkpoint…`
- **Embedding spaces** *(Node-only)* — `Embedding Spaces`, `Publish Caller Embeddings…`, `Bind Embedding Space Alias…`, `Set Default Embedding Space…`, `Delete Embedding Space…`, `Inspect Embedding Space Freshness…`
- **Write mode & transactions** *(Node-only)* — `Enable Capability…`, `Open with Write Mode…`, `Export Invocation Descriptor…`, `List Algorithm Runs`, `Publish Composite Transaction…` (Advanced)
- **Ontology** — `Show Ontology Viewer`, `Load Ontology…`, `Open ontology.json`, `Explain Ontology Mode`
- **Knowledge ledger** — `List Assertions`, `Create Assertion…`, `Show Assertion…`, `Show Assertion on Graph…`, `Attach Evidence…` / `Assess Confidence…` / `Record Assertion Status…` (Advanced)
- **Result views** — `Show Result Graph` (+ `Show Result Graph (Advanced)…`), `Show Project Capabilities`
- **Visualization artifacts** — `Create Project Visualization` (`graphforge.createProjectVisualization`) creates a complete v2 graph, chart, geospatial, or temporal artifact from explicit bindings; `Save Project Visualization` and `Open Saved Visualization` return the saved `path` and `spec` (plus panel status when opened)

Get Started's **Hub / Query / Visualize** pages are an editor over durable
project files: `queries/*.cypher`, `results/*`, `visualizations/*.gfviz.json`,
and `mutations/*.cypher`. New visualizations use the strict
`graphforge.visualization/v2` contract; existing v1 Cytoscape/Sigma/Plotly files
remain readable and are not rewritten on open. The G6/G2 settings are creation
templates only: the resolved renderer, backend, layout, bindings, filters,
coordinates, time settings, and presentation are saved into the artifact and
remain authoritative when global defaults change. Missing or unsupported
configuration fails visibly—there is no hidden field inference, size threshold,
renderer substitution, or layout fallback.

G2/L7/temporal panels expose the filtered rows in an accessible companion table.
Material viewport or temporal-range changes become visibly dirty and require an
explicit **Save**; **Revert** restores the committed artifact. The air-routes
sample copies its queries, results, and v1/v2 visualization specs into this
layout and generates its seed mutation there before execution; its bindings are
project files rather than extension constants.

Selecting a Results cell that contains a node/edge identity (including airport-style codes)
highlights that element in an open Result Graph. Selecting a metric cell or whole row falls back
to graph identities and `source`/`target` endpoints in that row. Graph clicks also reveal matching
table rows. Chart/map/timeline panels expose their filtered rows as a companion
surface, but point-to-row linking is not claimed because arbitrary G2/Plotly/L7
marks do not yet retain a stable source-row identity contract.

See [`docs/published/commands.md`](docs/published/commands.md) for the full command-ID table.
The module manifest, catalog-first distribution path, and side-load security
boundary are documented in [`docs/engineering/MODULES.md`](docs/engineering/MODULES.md).

## Knowledge ledger notes

- Identity UUIDs for assertions/evidence/confidence/status events must be UUIDv7 (engine-enforced); the extension mints them client-side (`src/session/uuid.ts`). Operation/idempotency UUIDs accept any version.
- Every knowledge-ledger native method (`listAssertions`, `createAssertion`, …) is optional on the `@curatelabs/graphforge` binding and feature-detected at call time — the sibling engine API is still moving and may change sync/async return shape or method names.
- `Record Assertion Status…` requires an existing `provenanceUuid`; until there's a provenance picker, paste one in directly.

### Coding agent interop

Every command above is a stable ID callable via `vscode.commands.executeCommand("graphforge.<id>", ...)` — no Command Palette click required. See [`docs/experience/agent-interop.md`](./docs/experience/agent-interop.md) for the full command table (args accepted, return shapes, which commands still require a QuickPick), the recommended Check Environment → Setup/Init → Run Query/Rank agent loop, and known gaps. `src/test/extension.test.ts` asserts this contract in CI.

For a single machine-readable entry point, call
`graphforge.agent.getContext`. It returns versioned JSON with runtime/settings,
the project marker, absolute query/result/visualization/mutation paths, and
canonical/latest result paths. Agents can then call `runProjectQuery(path)`,
`openProjectResult(path)`, `openProjectVisualization(path)`, or—after review—
`applyProjectMutation({ path, confirm: true })` without scraping a webview.

## License

Apache-2.0 © Curate Labs Inc.
