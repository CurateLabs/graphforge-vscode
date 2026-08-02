# Agent interop

Every command in [`commands.md`](commands.md) is a stable ID callable via
`vscode.commands.executeCommand("graphforge.<id>", ...)` — no Command Palette click required.
This makes GraphForge drivable end-to-end by an in-editor coding agent (a Cursor agent, GitHub
Copilot Agent Mode, or any other extension calling the VS Code command API), not just by a
human clicking through menus.

## The core loop

Start with `executeCommand("graphforge.agent.getContext")`. Its
`graphforge.agent-context/v1` result includes the environment report, effective
settings, project marker, absolute artifact paths, last-result paths, file
schemas, and the compact path-driven command set. Use
`graphforge.agent.listArtifacts` when only the artifact index is needed.

```mermaid
flowchart TD
    A["checkEnvironment({ silent: true })"] -->|runtime.active == 'none'| B["setupNativeBinding or setupPythonBinding"]
    A -->|project.open == false| C["initializeProjectHere or openProject(path)"]
    A -->|runtime + project ready| D["runQuery({ cypher, params }) or a verb command"]
    B --> A
    C --> A
    D -->|result.error present| B
    D -->|success| E["Read the result from the return value or the opened document"]
    E --> F["createProjectVisualization({ result, kind, explicit bindings })"]
```

1. **Check Environment** — `executeCommand("graphforge.checkEnvironment", { silent: true })`.
   Inspect `runtime.active` (`"node" | "python" | "none"`), `nodeBinding.available`,
   `python.available`, and `project.open`; the returned `nextAction` string always names the
   exact next command to run.
2. **Setup / Init if needed** — if no runtime is usable, run `graphforge.setupNativeBinding`
   and/or `graphforge.setupPythonBinding`. If a runtime is ready but no project is open, run
   `graphforge.initializeProjectHere` (new project) or `graphforge.openProject(path)` (existing
   project — `path` is a plain string arg, no picker needed). Re-run step 1 to confirm.
3. **Run Query / Rank** — call `graphforge.runQuery({ cypher, params })` for Cypher, or one of
   the analyst verb commands (these still walk a QuickPick today).
4. **Read the result** — either the `executeCommand` return value, or the opened JSON document
   the command also writes for a human pairing with the agent. On failure, the returned
   object's `error` / `code` / `nextAction` fields tell you exactly what to do next — never a
   bare exception or a silent no-op.
5. **Save visualization work** — call `graphforge.createProjectVisualization`
   with a result path, semantic kind, and complete bindings. It writes a strict
   v2 artifact before opening and returns `{ path, spec, panel? }`.

## What's structured vs. interactive

Every command that does engine work resolves with one of four shapes — never `undefined`:
its success payload (listed below), `{ error, code?, nextAction }` when no runtime/project is
usable, `{ cancelled: true }` when a human dismisses a prompt, or `{ error, code? }` when the
engine call fails. Destructive commands (`deleteCheckpoint`, `revertToCheckpoint`,
`deleteEmbeddingSpace`, `enableCapability`, `openWithWriteMode`,
`publishCompositeTransaction`) keep their confirmation modal unless args include
`confirm: true` — agents must opt in explicitly.

| Command | Accepts args to skip prompts | Returns (success payload) |
|---|---|---|
| `graphforge.checkEnvironment` | `{ silent?: boolean }` | `EnvironmentReport` always |
| `graphforge.copyEnvironmentReport` | none needed | `EnvironmentReport` (also copied to the clipboard) |
| `graphforge.agent.getContext` / `agent.listArtifacts` | `{ projectPath?: string \| Uri }` | Versioned context / artifact index JSON |
| `graphforge.openProject` | `string \| Uri \| { path }` | `{ path, project }` |
| `graphforge.openSampleProject` | `{ path?, force? }` | `{ path, project, seeded }` |
| `graphforge.runQuery` / `runQueryWithParams` | `{ cypher?: string; params?: Record<string, unknown> }` | `QueryResult` (`{ columns, rows, rowCount, algorithm? }`) |
| `graphforge.runProjectQuery` | `string \| Uri \| { path, resultName? }` | `QueryResult` |
| `graphforge.openProjectResult` | `string \| Uri \| { path }` | `{ path, absolutePath, columns, rowCount }` |
| `graphforge.openProjectVisualization` | `string \| Uri \| { path, waitForReady?, timeoutMs? }` | `{ path, absolutePath, kind, spec, panel?, lifecycle? }` |
| `graphforge.createProjectVisualization` | `{ name?, result, kind, renderer?, explicit bindings, filter?, open? }` | `{ path, spec, panel? }` |
| `graphforge.saveProjectVisualization` | `{ name?, spec, open? }` | `{ path, spec, panel? }` |

### Exact visualization creation arguments

Pass a project-relative `result`, a `kind`, and flattened kind-specific fields
to `graphforge.createProjectVisualization`. Common optional fields are `name`,
`open`, and `filter: { column, operator: "equals" | "contains", value }`.

- `result-graph`: optional `renderer: "g6" | "cytoscape" | "sigma"`.
- `chart`: `mark: "bar" | "scatter" | "line" | "histogram"`, `x`, `y`
  (except histogram), optional `color`, and optional
  `renderer: "g2" | "plotly"`.
- `geospatial`: `longitude` and `latitude` (L7).
- `temporal`: `timestamp` and `y`, plus optional `color`, `mark`, IANA
  `timezone`, and `granularity` (G2).

There is no nested `bindings` argument. The saved strict v2 artifact contains
the complete renderer, layout, mapping, and presentation choices.
| `graphforge.applyProjectMutation` | `{ path: string \| Uri; confirm: true }` | `{ path, absolutePath, columns, rowCount }` |
| `graphforge.importData` | `{ path: string \| Uri; label: string; mode?: "create" \| "merge"; idColumn?: string; confirm: true }` | `{ path, format, label, mode, idColumn?, imported, result }` |
| `graphforge.rank` / `cluster` / `paths` / `analyze` / `similar` (and `…Advanced…`) | Not yet — still QuickPick-driven | Verb result object (`{ verb, by, label, columns, rows, rowCount, algorithm? }`) |
| `graphforge.find` | Not yet — still prompt-driven | `QueryResult & { verb: "find", query, label? }`; a missing-index failure returns `{ error, code?, nextAction }` naming `graphforge.indexText` |
| `graphforge.createCheckpoint` / `listCheckpoints` / `diffCheckpoints` | `{ name?, description? }` / `{ limit? }` / `{ from?, to?, scope?, detail? }` | `QueryResult` |
| `graphforge.openCheckpoint` | `{ name?, cypher? }` | `{ checkpointUuid, generationUuid, query? }` |
| `graphforge.deleteCheckpoint` / `revertToCheckpoint` | `{ name?, confirm? }` / `{ name?, reason?, confirm? }` | `QueryResult` |
| `graphforge.embeddingSpaces` | none needed | `{ embeddingSpaces: [...], note? }` (empty list is a valid state) |
| `graphforge.publishCallerEmbeddings` | `{ name?, input? }` | `{ name, compatibilityId }` |
| `graphforge.bindEmbeddingSpaceAlias` | `{ alias?, compatibilityId?, replace? }` | `{ alias, compatibilityId, result }` |
| `graphforge.setDefaultEmbeddingSpace` | `{ name? }` or `{ clear: true }` | `{ name?, result }` |
| `graphforge.deleteEmbeddingSpace` | `{ name?, confirm? }` | `{ name, removed }` |
| `graphforge.inspectEmbeddingSpaceFreshness` | `{ name? }` (`{}` = default space) | `{ name?, freshness }` |
| `graphforge.indexText` | `{ label?, properties?, rebuild? }` | `{ command, result }` |
| `graphforge.indexVector` | `{ label?, node?, vector?, space? }` | `{ command, result }` |
| `graphforge.inspectTextIndex` | `{ label? }` | `{ command, result }` |
| `graphforge.indexAdjacency` / `inspectAdjacency` / `rebuildAdjacency` | none needed | `{ command, result }` |
| `graphforge.enableCapability` | `{ capabilityId?, version?, confirm? }` | `QueryResult` |
| `graphforge.openWithWriteMode` | `{ mode?, confirm? }` | `{ ok: true, writeMode }` |
| `graphforge.exportInvocationDescriptor` | `{ verb?, label?, by?, invoke? }` | `{ verb, algorithm, fingerprint, projectionFingerprint, canonicalBytesBase64, invocation? }` |
| `graphforge.listAlgorithmRuns` | `{ algorithm?, limit? }` | `QueryResult` |
| `graphforge.publishCompositeTransaction` | `{ request?, confirm? }` (both together) | `QueryResult` |
| `graphforge.listAssertions` | `{ graphUuid?, limit? }` | `QueryResult` |
| `graphforge.createAssertion` | `{ claim?, subjectUuid?, subjectKind? }` | `{ assertionUuid }` |
| `graphforge.showAssertion` / `showAssertionOnGraph` | `{ assertionUuid? }` or a plain UUID string | Assertion record + `nextActions` / `{ assertionUuid, graph }` |
| `graphforge.attachEvidence` | `{ assertionUuid?, sourceUuid?, sourceKind?, role? }` | `QueryResult` |
| `graphforge.assessConfidence` | `{ assertionUuid?, policy?, value? }` | `QueryResult` |
| `graphforge.recordAssertionStatus` | `{ assertionUuid?, status?, provenanceUuid? }` | `QueryResult` |
| `graphforge.setupNativeBinding` / `setupPythonBinding` / `initializeProjectHere` / `loadOntology` / `showResultGraphAdvanced` | No — these are inherently human choices (which folder, which binding source) | — |
| `graphforge.showOntology` / `showResultGraph` / `showCapabilities` / `openOntologyFile` / `explainOntologyMode` / `refreshExplorer` / `getStarted` / `chooseExperienceMode` / `openSettings` / `manageModules` / `statusBarClick` | No prompts to skip | — (view-openers; their effect is the UI they open) |

The full per-command contract (prompt-by-prompt) lives in
`docs/experience/agent-interop.md` in the repository, proven by the
`src/test/extension.test.ts` safe-commands suites in CI.

Project files are also a public contract: exact `FORMAT` marker; `.cypher`/`.cql`
or `{ cypher, params }` query specs; `{ columns, rows, rowCount }` results;
strict `graphforge.visualization/v2` `.gfviz.json` files for graph, chart,
geospatial, and temporal work; readable v1 Cytoscape/Sigma/Plotly files; and
reviewed writes under `mutations/`. V2 artifacts explicitly own renderer,
backend, layout, bindings, filters, coordinates/time, and presentation—settings
only choose the next creation template. Absolute and project-relative command
paths are accepted, but traversal
outside the project is rejected. The bundled sample includes `AGENTS.md` beside
these folders so a repository-aware agent can discover the contract directly.

GraphForge does not contribute a VS Code Language Model Tool on its current
`^1.96` engine floor because that version's stable extension API does not expose
tool registration. Commands, JSON returns, and project files are the portable
surface for Copilot, Cursor, and MCP bridges until the engine floor can move.

## Runtime awareness

`graphforge.runtime` (default `auto`) selects which engine backs a given call — see
[`install.md`](install.md) for the full Node-vs-Python policy. An agent that needs the advanced
Node-only surfaces (checkpoints, embedding spaces, indexing, invocation descriptors, composite
transactions, knowledge-ledger writes) should check `nodeBinding.available` from
`checkEnvironment` before calling them, since the Python bridge does not back those yet.
