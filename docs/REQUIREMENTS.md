# Requirements

Contract for the GraphForge VS Code extension: editor workbench over the embedded
engine so analysts can run Cypher and analyst verbs, browse ontology and knowledge
context, and view epistemic-aware result graphs.

## Functional requirements

| ID | Requirement | Derived from | Acceptance behavior |
|---|---|---|---|
| FR-1 | The system shall register language id `cypher` for `.cypher` and `.cql` with TextMate highlighting. | PRODUCT — Cypher first-class | Given a `.cypher` file, When opened, Then language mode is Cypher and keywords highlight. |
| FR-2 | The system shall provide **Run Query** using editor selection or document text via `forge.execute`. | PRODUCT — Cypher | Given an open project, When Run Query runs, Then rows are shown and optionally a result graph opens. |
| FR-3 | The system shall expose analyst verb commands: Rank, Cluster, Paths, Analyze, Similar, Find. | PRODUCT — verbs first-class | Given an open project, When a verb command runs with QuickPick inputs, Then the engine is invoked and results are shown. |
| FR-4 | The system shall detect GraphForge projects only when `FORMAT` equals `graphforge-project/v1\n`. | Engine project format | Given a folder with exact FORMAT bytes, When the explorer refreshes, Then the project appears; wrong FORMAT does not. |
| FR-5 | The system shall provide Activity Bar views: Projects, Ontology, Knowledge. | PRODUCT — workbench | Given activation, When the GraphForge container opens, Then three views are present. |
| FR-6 | The system shall open an Ontology Viewer webview showing mode and entity/relation/property trees. | PRODUCT — ontology | Given a project, When Show Ontology runs, Then mode badge and types render (or empty exploratory state). |
| FR-7 | The system shall open a Result Graph webview whose payload includes nodes/edges with optional `epistemicStatus` and `ontologyType`, plus a legend. | PRODUCT — epistemic viz | Given query/verb results or demo data, When the graph opens, Then status and class legend are visible. |
| FR-8 | The system shall fail closed with a clear message when `@graphforge/node` cannot be loaded. | PRODUCT — quality | Given no native binding, When Open Project / Run Query is attempted, Then an error explains linking the binding. |
| FR-9 | The system shall support a Python `graphforge` runtime as a first-class alternative to `@graphforge/node`, selected via `graphforge.runtime` (default `auto`, which always prefers Node). | Issue #12 | Given `graphforge.runtime` is `python` or `auto` with Node unavailable, When a project is opened, Then Cypher execute and at least one analyst verb (rank) run through the Python bridge with the same result shape as the Node path. |
| FR-10 | The system shall provide `GraphForge: Check Environment` reporting both Node-binding and Python-interpreter/`graphforge`-import status, which runtime is active, and one next action. | Issue #12 (extends #2) | Given the command runs, When the report is shown, Then it is agent-copyable JSON plus a 3-line human summary covering runtime, project, and next step. |
| FR-11 | The system shall provide `GraphForge: Setup Python Binding` as a single QuickPick (≤3 choices: use detected interpreter, select interpreter, `pip install graphforge` with explicit consent). | Issue #12 (UX doctrine from #1: palette-first, no cascading menus) | Given the command runs, When a choice is made, Then `graphforge.pythonInterpreterPath` is set and/or a `pip install` runs only after an explicit confirmation dialog. |
| FR-12 | The system shall detect Python interpreters in priority order: explicit config, VS Code Python extension selection, workspace venv (`.venv`/`venv`/`env`/`.conda`), then PATH. | Issue #12 | Given multiple candidates exist, When resolving, Then the first one with an importable `graphforge` wins. |

## Non-functional requirements

| ID | Quality attribute | Target / constraint | Why it matters |
|---|---|---|---|
| NFR-1 | Compatibility | VS Code `^1.96`, Node `>=20` | Aligns with engine Node bindings. |
| NFR-2 | Correctness boundary | No reimplementation of Cypher/verb/epistemic semantics in the extension (Node **or** Python path) | Engine is source of truth. |
| NFR-3 | Portability | Native addon resolved via optional peer, config path, or sibling monorepo | Dev and CI can work without published npm binary. |
| NFR-4 | License | Apache-2.0, publisher CurateLabs | Matches GraphForge engine. |
| NFR-5 | Default runtime | `@graphforge/node` remains the default; Python is opt-in/fallback only, never silently preferred over an available Node binding | Issue #12 constraint from product. |
| NFR-6 | Fail-closed dual runtime | When neither runtime is usable, error messages and recovery actions must cover both setup paths | Issue #12 — no dead-end failures. |

## Behavior trace

| Requirement | Given | When | Then |
|---|---|---|---|
| FR-4 | Folder with exact FORMAT marker | Discover projects | Project listed under Projects view |
| FR-2 | Open project + Cypher buffer | Run Query | JSON result document + optional graph panel |
| FR-7 | Graph payload with statuses | Show Result Graph | Nodes colored by epistemic status; legend lists statuses and types |

## Constraints & assumptions

- **Constraint:** Visualization colors for epistemic status are extension-owned (no product palette yet).
- **Constraint:** Committed ontology lives under `generations/<uuid>/participants/workspace/ontology.json`.
- **Assumption:** `@graphforge/node` returns Arrow IPC buffers decodable by `apache-arrow`.
- **Assumption:** Knowledge ledger wiring beyond stub counts lands after scaffold.

## Dependencies

- `@graphforge/node` — native engine facade (default runtime)
- `graphforge` (PyPI) + `pyarrow` — Python engine facade (alternative runtime, #12); resolved in
  a user-selected interpreter, never bundled with the extension
- `apache-arrow` — IPC table decode (shared by both runtimes)
- GraphForge engine project format and ontology participant layout

## Open questions

- Belief-projection policy defaults for statusless subjects in the graph UI — extension owners.
- Whether Marketplace publisher namespace is already claimed under CurateLabs — release owners.
