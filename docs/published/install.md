# Install and setup

## Requirements

- VS Code `^1.96.0`
- One GraphForge engine runtime — Node **or** Python (see below); you don't need both.

## Quick start

1. Install **GraphForge** from the Marketplace (or Open VSX).
2. Open a folder, then click the **GraphForge icon** in the Activity Bar. The **Get Started**
   view opens with a short setup checklist.
3. First visit only: the **Welcome** step asks how you want to work — **Guided** (confirms
   before changes) or **Autonomous** (fewer prompts, auto-opens results). Pick one and press
   **Continue**; change it anytime via **Change mode** or `graphforge.experienceMode`.
4. Work down the checklist:
   1. **Set up a runtime** (Node or Python — the primary button matches your workspace).
   2. **Open or create a project** — or choose **Try sample project** to seed the vendored
      **US air-routes** graph (586 airports / 7,430 routes, Apache-2.0) via
      `graphforge.openSampleProject`.
   3. **Run your first query** — with the sample open, use **Run sample query**.
      This executes `queries/templates/routes-overview.cypher` from the project.
   4. **See your results** — open the saved G6 route network, G2 route-distance
      chart, L7 airport map, or G2 route-activity timeline. The sample also keeps
      v1 Cytoscape and Plotly artifacts so compatibility is visible rather than
      hidden. Views stay closed until you ask.
5. Use the Hub, Query, and Visualize icons in the Get Started view title. Query
   saves reusable templates under `queries/templates/` and reopens timestamped
   `results/` history. Visualize saves strict v2 graph, chart, geospatial, or
   temporal settings under `visualizations/`; existing v1 artifacts remain
   readable. G6/G2 settings affect newly created files only because resolved
   behavior is stored in each artifact.

Prefer the Command Palette, or driving the extension from an agent? Run
**`GraphForge: Check Environment`** — it reports both runtimes' full diagnostics and always
names exactly one command to run next.

## Choosing a runtime: Node vs. Python

`graphforge.runtime` (setting, default `auto`) controls which engine backs Cypher execution
and the analyst verbs:

- **Node (`@curatelabs/graphforge`)** — the default for Node-ish and ambiguous workspaces. Fast,
  in-process, no subprocess. Also the only runtime backing the more advanced surfaces:
  checkpoints, embedding spaces, indexing, invocation descriptors, composite transactions, and
  knowledge-ledger writes.
- **Python (`graphforge` on PyPI)** — a first-class alternative for Cypher execute and the
  analyst verbs, communicating with a small bundled subprocess over newline-delimited JSON /
  Arrow IPC. No engine semantics are reimplemented in the extension.

In `auto`, **Node is the global default** — except when the workspace looks like a **Python
project** and not primarily a Node project, in which case `auto` prefers Python even if
`@curatelabs/graphforge` is also available:

- **Python signals:** `pyproject.toml`, `requirements.txt`, `uv.lock`, `.python-version`,
  `Pipfile`, `environment.yml`, `setup.py`, a notebook-dominant workspace root, or an explicitly
  selected VS Code Python interpreter.
- **Node signals:** a `package.json` at the workspace root.
- **If both are present:** Python wins only on a strong signal (`pyproject.toml`/`uv.lock`
  present, or a Python `graphforge` environment already usable); otherwise the workspace is
  treated as ambiguous and Node stays the default.
- Set `graphforge.runtime` to `node` or `python` explicitly to bypass detection entirely — an
  explicit preference never falls back to the other runtime.

Run **`GraphForge: Check Environment`** any time to see both runtimes' status, which one is
active, and the next step to fix whichever is missing.

## Setting up the Node binding

`@curatelabs/graphforge` is an optional peer dependency. Either:

- Run **`GraphForge: Setup Native Binding`** — one QuickPick offering: link a detected sibling
  build, browse to a built package folder (sets `graphforge.nativeModulePath`), or install it
  via `npm install @curatelabs/graphforge`; or
- Set `graphforge.nativeModulePath` yourself to an absolute path.

## Setting up the Python binding

**Package manager policy: [`uv`](https://docs.astral.sh/uv/) only — never `pip`.** If `uv`
isn't installed, [install it first](https://docs.astral.sh/uv/getting-started/installation/);
GraphForge will not fall back to `pip install`.

Run **`GraphForge: Setup Python Binding`** — a single QuickPick with up to three choices:

1. **Use detected interpreter** — checked in order: an explicit
   `graphforge.pythonInterpreterPath`, the interpreter selected in the
   [Python extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python),
   a workspace `.venv`/`venv`/`env` folder, then `python3`/`python` on `PATH`.
2. **Select interpreter…** — browse for a specific interpreter; sets
   `graphforge.pythonInterpreterPath`.
3. **Install via uv** — runs `uv add graphforge` in a uv-managed project (`pyproject.toml` /
   `uv.lock` present), otherwise `uv pip install --python <interpreter> graphforge`, only after
   you explicitly confirm. If `uv` isn't installed, the command stops and tells you to install
   it — it never falls back to `pip`.

Or from a terminal directly:

```bash
# in a uv-managed project (has pyproject.toml / uv.lock)
uv add graphforge

# targeting an arbitrary interpreter/venv instead
uv pip install --python /path/to/python graphforge
```

Requires the [`pyarrow`](https://pypi.org/project/pyarrow/) package alongside `graphforge`
(installed automatically as a `graphforge` dependency in most setups).

## Project detection

A folder is a GraphForge project only when it contains a `FORMAT` file whose exact contents
are `graphforge-project/v1\n` (including the trailing newline) — never inferred from Parquet
files alone.

No project yet? Run **`GraphForge: Initialize Project Here`** — it picks the current workspace
folder or one you choose, confirms once, and only ever succeeds on an empty or
already-initializing directory.

## Neither runtime available yet?

Commands and views still register. Query/open paths fail closed with a status-bar message and
an error offering both **Setup Native Binding** and **Setup Python Binding** — never a silent
no-op or an opaque exception.
