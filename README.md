# GraphForge for VS Code

Explore [GraphForge](https://docs.graphforge.sh/) projects in the editor: Cypher, analyst verbs, progressive ontology, and epistemic-aware result graphs.

Publisher: **CurateLabs** (`CurateLabs.graphforge`).

## Features (scaffold)

| Surface | What you get |
|---|---|
| **Cypher** | `.cypher` / `.cql` language id + TextMate highlighting + **Run Query** |
| **Analyst verbs** | Rank, Cluster, Paths, Analyze, Similar, Find (QuickPick → engine) |
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
- `GraphForge: Open ontology.json` / `Explain Ontology Mode`
- `GraphForge: List Assertions` / `Create Assertion…` / `Show Assertion…` / `Show Assertion on Graph…`
- `GraphForge: Attach Evidence…` / `Assess Confidence…` / `Record Assertion Status…` (Advanced)

## Knowledge ledger notes

- Identity UUIDs for assertions/evidence/confidence/status events must be UUIDv7 (engine-enforced); the extension mints them client-side (`src/session/uuid.ts`). Operation/idempotency UUIDs accept any version.
- Every knowledge-ledger native method (`listAssertions`, `createAssertion`, …) is optional on the `@graphforge/node` binding and feature-detected at call time — the sibling engine API is still moving and may change sync/async return shape or method names.
- `Record Assertion Status…` requires an existing `provenanceUuid`; until there's a provenance picker, paste one in directly.

## License

Apache-2.0 © Curate Labs Inc.
