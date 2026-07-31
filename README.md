# GraphForge for VS Code

Explore [GraphForge](https://docs.graphforge.sh/) projects in the editor: Cypher, analyst verbs, progressive ontology, and epistemic-aware result graphs.

Publisher: **CurateLabs** (`CurateLabs.graphforge`).

## Features (scaffold)

| Surface | What you get |
|---|---|
| **Cypher** | `.cypher` / `.cql` language id + TextMate highlighting + **Run Query** |
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

### Runtimes: Node (default) and Python (alternative)

The extension can run Cypher and analyst verbs through either engine binding:

- **Node (`@graphforge/node`)** — the default. Fast, in-process, no subprocess.
- **Python (`graphforge` on PyPI)** — a first-class alternative for analysts already living in
  a Python/notebook workflow, or when a native Node binding isn't available for your platform.

Which one is used is controlled by `graphforge.runtime` (`auto` | `node` | `python`, default
`auto`). In `auto`, Node is always preferred; Python is only used when Node is unavailable and a
Python interpreter with `graphforge` importable was detected.

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

Run **`GraphForge: Setup Python Binding`** — a single QuickPick with up to three choices:

1. **Use detected interpreter** — the extension looks for, in order: an explicit
   `graphforge.pythonInterpreterPath`, the interpreter currently selected in the
   [Python extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python),
   a workspace `.venv`/`venv`/`env` folder, then `python3`/`python` on `PATH`.
2. **Select interpreter…** — browse for a specific `python`/`python3` executable; this sets
   `graphforge.pythonInterpreterPath`.
3. **pip install graphforge** — runs `<interpreter> -m pip install graphforge` in a terminal,
   only after you explicitly confirm (this makes a network request).

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

### Project detection

A folder is a GraphForge project only when it contains a `FORMAT` file whose exact contents are:

```text
graphforge-project/v1
```

(including the trailing newline). Never inferred from Parquet alone.

## Commands

- `GraphForge: Open Project`
- `GraphForge: Run Query`
- `GraphForge: Rank` / `Cluster` / `Paths` / `Analyze` / `Similar` / `Find`
- `GraphForge: Show Ontology Viewer`
- `GraphForge: Show Result Graph`
- `GraphForge: Show Project Capabilities`
- `GraphForge: Load Ontology…`
- `GraphForge: Check Environment`
- `GraphForge: Setup Native Binding`
- `GraphForge: Setup Python Binding`
- `GraphForge: Initialize Project Here`

## License

Apache-2.0 © Curate Labs Inc.
