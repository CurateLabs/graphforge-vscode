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

## License

Apache-2.0 © Curate Labs Inc.
