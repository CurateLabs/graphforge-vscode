# GraphForge for VS Code

[![CodSpeed](https://img.shields.io/endpoint?url=https://codspeed.io/badge.json)](https://app.codspeed.io/CurateLabs/graphforge-vscode?utm_source=badge)

Explore [GraphForge](https://docs.graphforge.sh/) projects in the editor: Cypher, analyst verbs, progressive ontology, and epistemic-aware result graphs.

Publisher: **CurateLabsAI** (`CurateLabsAI.graphforge`).

## Install

- [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=CurateLabsAI.graphforge)
- [Open VSX](https://open-vsx.org/extension/CurateLabsAI/graphforge)

After install, run **`GraphForge: Check Environment`** from the Command Palette. For a guided first project, use **Get Started** in the GraphForge activity bar, or **`GraphForge: Open Sample Project`**.

User-facing docs: [`docs/published/`](docs/published/) ([overview](docs/published/overview.md), [install](docs/published/install.md), [commands](docs/published/commands.md), [agent interop](docs/published/agent-interop.md)).

## Features

| Surface | What you get |
|---|---|
| **Setup** | Check Environment, Setup Native Binding, Initialize Project Here — palette-first, never a dead end |
| **Cypher** | `.cypher` / `.cql` language id + TextMate highlighting + **Run Query** (+ Advanced: Run Query with Parameters…) |
| **Analyst verbs** | Rank, Cluster, Paths, Analyze, Similar, Find (QuickPick → engine; all except Find have an Advanced… variant for optional params) |
| **Projects** | Activity-bar explorer for folders with a valid `FORMAT` marker |
| **Ontology** | Mode badge + entity/relation tree; Ontology Viewer webview with a helpful exploratory empty state, **Load Ontology…**, and an Advanced section (open `ontology.json`, explain mode) |
| **Knowledge** | Inspect and create assertions: list/empty states, **Create Assertion…** (minimal fields), **Show Assertion** / **Show on Graph**, plus Advanced attach-evidence / assess-confidence / record-status commands |
| **Results** | Interactive table in the bottom Panel; expandable nested JSON and row/cell selection linked to matching Result Graph nodes/edges |
| **XYG visualizations** | Native graph, chart, map and timeline composition, one shared painter, explicit saved intent, and PNG/SVG exports |
| **Modules** | One Module Bay for default, non-removable Query/Visualize/Import modules, future GraphForge-catalog modules, and advanced side-loads |

## Requirements

- VS Code `^1.96.0`
- One GraphForge engine runtime, either:
  - **Node** — a built `@curatelabs/graphforge` package (optional peer dependency), or
  - **Python** — a `graphforge` (PyPI) install in an interpreter VS Code can see, plus [`uv`](https://docs.astral.sh/uv/) for setup (never `pip`)
- **Qualified Core** — this build declares the Core versions it was qualified against in `package.json` (`graphforge.qualifiedCore`, currently `>=0.6.0-rc.5 <0.7.0`). Outside that range the extension warns (`CORE_VERSION_UNQUALIFIED`); below the declared floor it refuses (`CORE_VERSION_UNSUPPORTED`). Either way the message names the fix: set `graphforge.engineVersion` or pick a matching Python environment. `Check Environment` reports the verdict under `core`.
- No runtime yet? Run **`GraphForge: Check Environment`** after installing — it always tells you what to run next.

## Develop

```bash
git submodule update --init vendor/xyg
npm ci
npm run compile
```

Press **F5** (`Run Extension`) to open an Extension Development Host.

See [the XYG visualization contract](docs/engineering/XYG.md) for the native engine, saved intent, build and qualification details.

### Benchmarks (CodSpeed)

Benchmarks cover Arrow decoding and Results table preparation. XYG maintains its engine benchmarks upstream.

CI runs the same suites on every pull request through
[CodSpeed](https://app.codspeed.io/CurateLabs/graphforge-vscode) in CPU
simulation mode (`.github/workflows/codspeed.yml`), which reports the change
against the base commit. To reproduce a CI measurement locally:

```bash
npm run compile:bench
codspeed run --mode simulation -- npm run bench:run
```

### Runtimes: Node (default) and Python (alternative)

The extension runs Cypher and analyst verbs through either the Node or Python Core binding. XYG is bundled independently for native visualization.

The command bridge preserves runtime parity, but the primary Python experience is
analyst-authored scripts and notebooks in the selected environment. GraphForge opens and
indexes those project files; it does not turn Python work into hidden extension state.

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
- **Visualization artifacts** — `Create Project Visualization` (`graphforge.createProjectVisualization`) creates a complete `xyg.intent/v1` graph, chart, geospatial, or temporal artifact from explicit bindings; `Save Project Visualization` and `Open Saved Visualization` return the saved `path` and `spec` (plus panel status when opened)

See [the XYG visualization contract](docs/engineering/XYG.md) for the native engine, saved intent, build and qualification details.

See [`docs/published/commands.md`](docs/published/commands.md) for the full command-ID table.
The module manifest, catalog-first distribution path, and side-load security
boundary are documented in [`docs/engineering/MODULES.md`](docs/engineering/MODULES.md).

## Knowledge ledger notes

- Identity UUIDs for assertions/evidence/confidence/status events must be UUIDv7 (engine-enforced); the extension mints them client-side (`src/session/uuid.ts`). Operation/idempotency UUIDs accept any version.
- Every knowledge-ledger native method (`listAssertions`, `createAssertion`, …) is optional on the `@curatelabs/graphforge` binding and feature-detected at call time — the sibling engine API is still moving and may change sync/async return shape or method names.
- `Record Assertion Status…` requires an existing `provenanceUuid`; until there's a provenance picker, paste one in directly.

### Coding agent interop

Every command above is a stable ID callable via
`vscode.commands.executeCommand("graphforge.<id>", ...)`. See
[`docs/published/agent-interop.md`](docs/published/agent-interop.md) for the
command table, return shapes, and the Check Environment → Setup/Init → Run
Query/Rank loop. `src/test/extension.test.ts` asserts this contract in CI.

For a single machine-readable entry point, call `graphforge.agent.getContext`.
It returns versioned JSON with runtime/settings, the project marker, absolute
artifact paths, and canonical/latest result paths.

## Documentation

| Audience | Start here |
|---|---|
| Users / Marketplace | [`docs/published/`](docs/published/) |
| Contributors | [`docs/README.md`](docs/README.md) (product, design, requirements, architecture) |
| Publishing | [`docs/engineering/PUBLISHING.md`](docs/engineering/PUBLISHING.md) |

## License

Apache-2.0 © Curate Labs Inc.
