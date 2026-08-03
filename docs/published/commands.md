# Command map

Every command below is a stable ID, invokable from the Command Palette or programmatically via
`vscode.commands.executeCommand("<id>", ...)`. Commands marked **Node-only** require the
`@curatelabs/graphforge` runtime — they aren't backed by the Python bridge yet (see
[`install.md`](install.md)).

## Setup

| Command | ID | What it does |
|---|---|---|
| GraphForge: Check Environment | `graphforge.checkEnvironment` | Reports both runtimes' status, which one is active, and the single next step. Accepts optional `{ silent: true }`. |
| GraphForge: Setup Native Binding | `graphforge.setupNativeBinding` | QuickPick to link/browse/install `@curatelabs/graphforge`. |
| GraphForge: Setup Python Binding | `graphforge.setupPythonBinding` | QuickPick to select a Python interpreter or install `graphforge` via `uv`. |
| GraphForge: Initialize Project Here | `graphforge.initializeProjectHere` | Creates a new GraphForge project in an empty/uninitialized folder. |
| GraphForge: Open Project | `graphforge.openProject` | Opens an existing `FORMAT`-marked project; accepts a string, URI, or `{ path }`. |
| GraphForge: Open Sample Project | `graphforge.openSampleProject` | Seeds/opens the vendored US air-routes sample (Apache-2.0); accepts `{ path?, force? }`. Interactive replacement of a non-empty target confirms; creating a new sample does not add a redundant prompt. |
| GraphForge: Open Sample Python Notebook | `graphforge.openSampleNotebook` | Opens the active air-routes sample's project-owned VS Code Jupyter notebook and returns `{ path, relativePath }`. It never installs packages or selects a kernel. |
| GraphForge: Close Project | `graphforge.closeProject` | Detaches the active engine session (no folder delete). |
| GraphForge: Refresh Explorer | `graphforge.refreshExplorer` | Refreshes the Projects Activity Bar view. |
| GraphForge: Agent: Get Context | `graphforge.agent.getContext` | Returns `graphforge.agent-context/v1` runtime, settings, marker, artifact, last-result, schema, and command JSON; optional `{ projectPath }`. |
| GraphForge: Agent: List Project Artifacts | `graphforge.agent.listArtifacts` | Returns `graphforge.artifact-index/v1` with project-relative and absolute paths; optional `{ projectPath }`. |
| GraphForge: Get Started | `graphforge.getStarted` | Opens the persistent Environment → Project → Query → Result → Visualize journey map. |
| GraphForge: Show Hub | `graphforge.getStarted.showHub` | Opens Get Started's Hub surface; contributed as its Home title action. |
| GraphForge: Show Query | `graphforge.getStarted.showQuery` | Opens Get Started's Query surface; contributed as its Search title action. |
| GraphForge: Show Visualize | `graphforge.getStarted.showVisualize` | Opens Get Started's Visualize surface; contributed as its Graph title action. |
| GraphForge: Settings | `graphforge.openSettings` | Opens the GraphForge Settings panel — left-nav categories (Runtime / Visualizations / Advanced) over the same `graphforge.*` settings as the VS Code Settings UI. |

## Modules and import

| Command | ID | What it does |
|---|---|---|
| GraphForge: Manage Modules | `graphforge.manageModules` | Opens the Module Bay for default, GraphForge-catalog, and side-loaded modules. |
| GraphForge: Install Module from File… | `graphforge.installModuleFromFile` | Installs a validated manifest file or a folder containing `graphforge-module.json`. |
| GraphForge: Refresh Modules | `graphforge.refreshModules` | Refreshes manifests published by the active GraphForge runtime/project. |
| GraphForge: Import Data… | `graphforge.importData` | Imports CSV/JSON/JSONL/NDJSON objects as nodes; programmatic callers pass `{ path, label, mode?, idColumn?, confirm: true }`. |

## Cypher

| Command | ID | What it does |
|---|---|---|
| GraphForge: Run Query | `graphforge.runQuery` | Runs Cypher from the editor selection, the whole document, or an input box; accepts `{ cypher?, params?, resultName? }` to skip prompts and optionally name the durable result. |
| GraphForge: Run Query with Parameters… | `graphforge.runQueryWithParams` | Same as Run Query, plus a JSON parameters prompt (or pass `{ cypher, params }` directly). |
| GraphForge: Run Project Query | `graphforge.runProjectQuery` | Reads and runs a string, URI, or `{ path, resultName? }` inside the open project. |
| GraphForge: Save Project Query | `graphforge.saveProjectQuery` | Writes `{ name?, cypher, run?, resultName? }` under `queries/`. |
| GraphForge: Save Project Query Template | `graphforge.saveProjectQueryTemplate` | Writes `{ name?, cypher, run?, resultName? }` under `queries/templates/`; unnamed templates use `query-YYYYMMDD-HHMMSS-mmm`. |

## Project artifacts

| Command | ID | Args |
|---|---|---|
| Open Saved Result | `graphforge.openProjectResult` | String, URI, or `{ path }` — restores a `results/*.json` file into the Results table and session views. |
| Open Saved Visualization | `graphforge.openProjectVisualization` | String, URI, or `{ path, waitForReady?, timeoutMs? }` — validates v1/v2, loads its referenced result/filters, opens the recorded adapter, and returns `{ path, absolutePath, kind, spec, panel?, lifecycle? }`. `waitForReady: true` explicitly waits 1–60 seconds (30 seconds by default) for `renderReady` or a structured terminal failure. |
| Create Project Visualization | `graphforge.createProjectVisualization` | `{ name?, result, kind, renderer?, explicit bindings, filter?, open? }` — materializes and saves a complete v2 graph/chart/geospatial/temporal spec before opening; returns `{ path, spec, panel? }`. |
| Save Project Visualization | `graphforge.saveProjectVisualization` | `{ name?, spec, open? }` — validates and writes under `visualizations/`; returns `{ path, spec, panel? }`. |
| Open Project Artifact | `graphforge.openProjectArtifact` | String, URI, or `{ path }` — opens a project file in the editor. |
| Apply Project Mutation… | `graphforge.applyProjectMutation` | `{ path, confirm: true }` for non-interactive use; confines executable `.cypher`/`.cql`/JSON specs to `mutations/`. |

`graphforge.createProjectVisualization` uses flattened arguments, not a nested
bindings object. In addition to the project-relative `result` and `kind`, pass:

- `result-graph`: optional `renderer` (`g6`, `cytoscape`, or `sigma`).
- `chart`: `mark`, `x`, `y` (except histogram), optional `color`, and optional
  `renderer` (`g2` or `plotly`).
- `geospatial`: source `longitude` and `latitude`; optional `targetLongitude`
  and `targetLatitude` persist an L7 link source with arc and endpoint layers.
- `temporal`: `timestamp` and `y`, plus optional `color`, `mark`, IANA
  `timezone`, and `granularity` (G2 is persisted).

All kinds also accept optional `name`, `open`, and
`filter: { column, operator: "equals" | "contains", value }`.

## Analyst verbs

Each verb has a plain command (walks a QuickPick chain: label, then algorithm) and an
`…Advanced…` variant (adds via/directed/write-property prompts where applicable).

| Verb | Plain | Advanced |
|---|---|---|
| Rank | `graphforge.rank` | `graphforge.rankAdvanced` |
| Cluster | `graphforge.cluster` | `graphforge.clusterAdvanced` |
| Paths | `graphforge.paths` | `graphforge.pathsAdvanced` |
| Analyze | `graphforge.analyze` | `graphforge.analyzeAdvanced` |
| Similar | `graphforge.similar` | `graphforge.similarAdvanced` |
| Find | `graphforge.find` | — |

## Indexing **(Node-only)**

| Command | ID |
|---|---|
| GraphForge: Index Text… | `graphforge.indexText` |
| GraphForge: Index Vector… | `graphforge.indexVector` |
| GraphForge: Inspect Text Index… | `graphforge.inspectTextIndex` |
| GraphForge: Index Adjacency | `graphforge.indexAdjacency` |
| GraphForge: Inspect Adjacency Index | `graphforge.inspectAdjacency` |
| GraphForge: Rebuild Adjacency Index | `graphforge.rebuildAdjacency` |

## Checkpoints **(Node-only)**

| Command | ID |
|---|---|
| GraphForge: Create Checkpoint… | `graphforge.createCheckpoint` |
| GraphForge: List Checkpoints | `graphforge.listCheckpoints` |
| GraphForge: Open Checkpoint… | `graphforge.openCheckpoint` |
| GraphForge: Diff Checkpoints… | `graphforge.diffCheckpoints` |
| GraphForge: Delete Checkpoint… | `graphforge.deleteCheckpoint` |
| GraphForge: Revert to Checkpoint… | `graphforge.revertToCheckpoint` |

## Embedding spaces **(Node-only)**

| Command | ID |
|---|---|
| GraphForge: Embedding Spaces | `graphforge.embeddingSpaces` |
| GraphForge: Publish Caller Embeddings… | `graphforge.publishCallerEmbeddings` |
| GraphForge: Bind Embedding Space Alias… | `graphforge.bindEmbeddingSpaceAlias` |
| GraphForge: Set Default Embedding Space… | `graphforge.setDefaultEmbeddingSpace` |
| GraphForge: Delete Embedding Space… | `graphforge.deleteEmbeddingSpace` |
| GraphForge: Inspect Embedding Space Freshness… | `graphforge.inspectEmbeddingSpaceFreshness` |

## Write mode & transactions **(Node-only)**

| Command | ID |
|---|---|
| GraphForge: Enable Capability… | `graphforge.enableCapability` |
| GraphForge: Open with Write Mode… | `graphforge.openWithWriteMode` |
| GraphForge: Export Invocation Descriptor… | `graphforge.exportInvocationDescriptor` |
| GraphForge: List Algorithm Runs | `graphforge.listAlgorithmRuns` |
| GraphForge: Publish Composite Transaction… (Advanced) | `graphforge.publishCompositeTransaction` |
| GraphForge: Run CLI… | `graphforge.runCli` |

**Run CLI** runs the engine's repository-lifecycle CLI (`@curatelabs/graphforge-cli`:
`init`, `sync`, `status`, `checkpoint …`, `export`/`import`, `config validate`, `skills …`)
in-process through the Node binding — no separate install and no shelling out. Outside VS
Code the same CLI is available as `npx @curatelabs/graphforge-cli` (or the `gf` / `graphforge`
bin). **Node-only.**

## Ontology

| Command | ID |
|---|---|
| GraphForge: Show Ontology Viewer | `graphforge.showOntology` |
| GraphForge: Load Ontology… | `graphforge.loadOntology` |
| GraphForge: Open ontology.json | `graphforge.openOntologyFile` |
| GraphForge: Explain Ontology Mode | `graphforge.explainOntologyMode` |

## Knowledge ledger

| Command | ID |
|---|---|
| GraphForge: List Assertions | `graphforge.listAssertions` |
| GraphForge: Create Assertion… | `graphforge.createAssertion` |
| GraphForge: Show Assertion… | `graphforge.showAssertion` |
| GraphForge: Show Assertion on Graph… | `graphforge.showAssertionOnGraph` |
| GraphForge: Attach Evidence… (Advanced) | `graphforge.attachEvidence` |
| GraphForge: Assess Confidence… (Advanced) | `graphforge.assessConfidence` |
| GraphForge: Record Assertion Status… (Advanced) | `graphforge.recordAssertionStatus` |

Identity UUIDs for assertions/evidence/confidence/status events are minted client-side as
UUIDv7 (engine-enforced). Knowledge-ledger writes require the Node runtime.

## Result views

| Command | ID |
|---|---|
| GraphForge: Show Results Table | `graphforge.showResultsTable` |
| GraphForge: Show Result Graph | `graphforge.showResultGraph` |
| GraphForge: Result Graph (Advanced)… | `graphforge.showResultGraphAdvanced` |
| GraphForge: Show Figure | `graphforge.showFigure` |
| GraphForge: Figure from Result… | `graphforge.figureFromResult` |
| GraphForge: Show Project Capabilities | `graphforge.showCapabilities` |

New Result Graph artifacts default to Cytoscape Canvas; Plotly is the default
for new analytical chart artifacts. G2 remains an explicit chart option and the
temporal adapter, while L7 renders geospatial artifacts. G6 and Sigma remain
explicit graph adapters. `graphforge.resultGraph.renderer` and
`graphforge.chart.renderer` choose creation templates only: a saved artifact
continues using its recorded renderer, backend, layout, bindings, and filters.
Unsupported configuration reports a failure and never silently switches adapter.

Successful Cypher and analyst-verb commands reveal **GraphForge Results** in the bottom Panel
instead of opening a disposable JSON/Markdown editor tab. Run Query still persists
`results/query-result.json` and `results/query-result.md`; the panel's JSON and Markdown buttons
open those durable files on demand. Table selection links to matching IDs/codes/endpoints in an
open Result Graph, and graph selection highlights matching rows. Chart/map/time
panels expose an accessible filtered-data companion, but point-to-row linking is
not claimed because arbitrary marks do not preserve source-row provenance.

See [`agent-interop.md`](agent-interop.md) for which of these accept structured arguments and
return structured results for programmatic (agent) callers, and the source-of-truth test
(`src/test/extension.test.ts`) that asserts every command above is registered.
