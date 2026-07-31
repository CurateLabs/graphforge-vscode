# GraphForge for VS Code

Explore [GraphForge](https://docs.graphforge.sh/) projects in the editor: Cypher, analyst verbs, progressive ontology, and epistemic-aware result graphs.

Publisher: **CurateLabs** (`CurateLabs.graphforge`).

## Features (scaffold)

| Surface | What you get |
|---|---|
| **Setup** | Check Environment, Setup Native Binding, Initialize Project Here — palette-first, never a dead end |
| **Cypher** | `.cypher` / `.cql` language id + TextMate highlighting + **Run Query** (+ Advanced: Run Query with Parameters…) |
| **Analyst verbs** | Rank, Cluster, Paths, Analyze, Similar, Find (QuickPick → engine; each has an Advanced… variant for optional params) |
| **Projects** | Activity-bar explorer for folders with a valid `FORMAT` marker |
| **Ontology** | Mode badge + entity/relation tree; Ontology Viewer webview with a helpful exploratory empty state, **Load Ontology…**, and an Advanced section (open `ontology.json`, explain mode) |
| **Knowledge** | Inspect and create assertions: list/empty states, **Create Assertion…** (minimal fields), **Show Assertion** / **Show on Graph**, plus Advanced attach-evidence / assess-confidence / record-status commands |
| **Result Graph** | Webview shell: nodes/edges styled by class + epistemic status |

## Develop

```bash
npm install
npm run compile
```

Press **F5** (`Run Extension`) to open an Extension Development Host.

### Runtimes: Node (default) and Python (alternative)

The extension can run Cypher and analyst verbs through either engine binding:

- **Node (`@graphforge/node`)** — the default. Fast, in-process, no subprocess.
- **Python (`graphforge` on PyPI)** — a first-class alternative for analysts already living in
  a Python/notebook workflow, or when a native Node binding isn't available for your platform.

Which one is used is controlled by `graphforge.runtime` (`auto` | `node` | `python`, default
`auto`). In `auto`, **Node is the global default** — except when the workspace looks like a
**Python project** (and not primarily a Node project), in which case `auto` prefers Python even
if `@graphforge/node` is also available:

- **Python signals:** `pyproject.toml`, `requirements.txt`, `uv.lock`, `.python-version`,
  `Pipfile`, `environment.yml`, `setup.py`, a notebook-dominant workspace root, or an explicitly
  selected VS Code Python interpreter.
- **Node signals:** a `package.json` at the workspace root (whether or not it depends on
  `@graphforge/node`).
- **If both are present:** Python wins only on a *strong* signal — `pyproject.toml`/`uv.lock`
  present, or a Python `graphforge` environment already usable. Otherwise the workspace is
  ambiguous and Node stays the default, per the rule that "Node remains the global default only
  when the repo is Node-ish or ambiguous."
- Set `graphforge.runtime` to `node` or `python` explicitly to bypass this detection entirely —
  an explicit preference never falls back to the other runtime, regardless of project kind.

Run **`GraphForge: Check Environment`** any time to see both runtimes' status, which one is
active, and the single next step to fix whichever is missing.

#### Node binding (`@graphforge/node`)

The package is an **optional peer dependency**. Link a local build from the engine monorepo:

```bash
# in graphforge/
# build the napi package (see crates/gf-bindings-node)
cd crates/gf-bindings-node && npm run build

# in graphforge-vscode/
npm install ../graphforge/crates/gf-bindings-node
```

Or run **`GraphForge: Setup Native Binding`**, or set `graphforge.nativeModulePath` to the
absolute path of a built `@graphforge/node` package directory.

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

- `GraphForge: Check Environment` (`graphforge.checkEnvironment`) — accepts optional `{ silent: true }` to suppress the toast/opened doc; always returns the `EnvironmentReport` JSON from `executeCommand`
- `GraphForge: Setup Native Binding`
- `GraphForge: Initialize Project Here`
- `GraphForge: Open Project` (`graphforge.openProject`) — accepts an optional folder-path string arg to skip the picker
- `GraphForge: Run Query` (`graphforge.runQuery`) — selection → whole file → single input box, or pass `{ cypher, params? }` to skip both; opens a structured `{ columns, rows, rowCount }` results document, reports row count, and returns that same object from `executeCommand`
- `GraphForge: Run Query with Parameters…` (`graphforge.runQueryWithParams`) — Advanced: same input resolution, plus a JSON parameters prompt (or pass `{ cypher, params }` directly)
- `GraphForge: Rank` / `Cluster` / `Paths` / `Analyze` / `Similar` / `Find` (each has an `…Advanced…` command for optional/weedy parameters) — QuickPick-driven today; each now returns its result JSON (or `{ error }` / `{ cancelled: true }`) from `executeCommand`
- `GraphForge: Show Ontology Viewer`
- `GraphForge: Show Result Graph` (+ `Show Result Graph (Advanced)…`)
- `GraphForge: Show Project Capabilities`
- `GraphForge: Load Ontology…`
- `GraphForge: Open ontology.json` / `Explain Ontology Mode`
- `GraphForge: List Assertions` / `Create Assertion…` / `Show Assertion…` / `Show Assertion on Graph…`
- `GraphForge: Attach Evidence…` / `Assess Confidence…` / `Record Assertion Status…` (Advanced)
- `GraphForge: Setup Python Binding` — alternative to `Setup Native Binding` when running on the Python `graphforge` runtime (#12)

## Knowledge ledger notes

- Identity UUIDs for assertions/evidence/confidence/status events must be UUIDv7 (engine-enforced); the extension mints them client-side (`src/session/uuid.ts`). Operation/idempotency UUIDs accept any version.
- Every knowledge-ledger native method (`listAssertions`, `createAssertion`, …) is optional on the `@graphforge/node` binding and feature-detected at call time — the sibling engine API is still moving and may change sync/async return shape or method names.
- `Record Assertion Status…` requires an existing `provenanceUuid`; until there's a provenance picker, paste one in directly.

## Runtimes: Node vs Python (#12)

`graphforge.runtime` (default `auto`) selects which engine backs Cypher/verb calls. `auto` always prefers `@graphforge/node` and only falls back to the Python `graphforge` bridge when Node is unavailable; `node`/`python` pin to one runtime and fail closed (with setup guidance for that path) rather than silently falling back. The Python bridge currently backs `execute` and the analyst verbs; Node-only surfaces (checkpoints, embedding spaces, indexing, invocation descriptors, composite transactions, and the full knowledge-ledger write API) require the Node runtime for now. Run **GraphForge: Check Environment** to see both runtimes' status and the active one, or **GraphForge: Setup Python Binding** to configure the interpreter.

### Coding agent interop

Every command above is a stable ID callable via `vscode.commands.executeCommand("graphforge.<id>", ...)` — no Command Palette click required. See [`docs/experience/agent-interop.md`](./docs/experience/agent-interop.md) for the full command table (args accepted, return shapes, which commands still require a QuickPick), the recommended Check Environment → Setup/Init → Run Query/Rank agent loop, and known gaps. `src/test/extension.test.ts` asserts this contract in CI.

## License

Apache-2.0 © Curate Labs Inc.
