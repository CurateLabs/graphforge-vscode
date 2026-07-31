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
| FR-9 | The system shall provide **Create Assertion…** with minimal fields (claim, subject UUID, subject kind) via the palette, minting UUIDv7 identities client-side. | PRODUCT — Knowledge (#6) | Given an open project, When Create Assertion runs and the claim/subject are provided, Then one assertion is written and the Knowledge view refreshes to show it. |
| FR-10 | The system shall provide separate Advanced commands — **Attach Evidence…**, **Assess Confidence…**, **Record Assertion Status…** — kept out of Create Assertion. | PRODUCT — Knowledge (#6) | Given an existing assertion, When an Advanced command runs, Then the corresponding immutable ledger write completes without needing to know it exists during Create Assertion. |
| FR-11 | The Knowledge view shall render list/empty/inspect states: no project, capability unavailable, empty ledger, and a populated assertion list with a **Show Assertion** action per item. | PRODUCT — Knowledge (#6) | Given each state, When the view refreshes, Then it shows a matching, actionable node (not a blank tree). |
| FR-12 | The Ontology view and viewer shall render a helpful empty state in exploratory mode (not an error) with an obvious **Load Ontology…** action, and refresh both immediately after a load. | PRODUCT — Ontology (#7) | Given exploratory mode with no ontology loaded, When the view/viewer render, Then they explain the mode and offer Load Ontology…; after loading, both refresh to the new ontology. |
| FR-13 | The Ontology viewer shall expose an **Advanced** section to open the raw `ontology.json` and explain the current progressive mode (exploratory/advisory/strict). | PRODUCT — Ontology (#7) | Given the viewer is open, When Advanced → Open ontology.json / Explain Ontology Mode runs, Then the file or an explanation document opens. |
| FR-14 | The system shall support a Python `graphforge` runtime as a first-class alternative to `@graphforge/node`, selected via `graphforge.runtime` (default `auto`). In `auto`, Node is the global default **except** when the workspace looks Python-first (see FR-18), in which case Python is preferred when usable. | Issue #12 | Given `graphforge.runtime` is `python`, or `auto` with Node unavailable, or `auto` in a Python-first workspace with Python usable, When a project is opened, Then Cypher execute and at least one analyst verb (rank) run through the Python bridge with the same result shape as the Node path. |
| FR-15 | The system shall provide `GraphForge: Check Environment` reporting both Node-binding and Python-interpreter/`graphforge`-import status, which runtime is active, the detected project kind, and one next action. | Issue #12 (extends #2) | Given the command runs, When the report is shown, Then it is agent-copyable JSON plus a 3-line human summary covering runtime, project, and next step. |
| FR-16 | The system shall provide `GraphForge: Setup Python Binding` as a single QuickPick (≤3 choices: use detected interpreter, select interpreter, install `graphforge` via **uv** with explicit consent). Package installs use **uv only, never pip**; if `uv` is not installed, the command tells the user to install uv first instead of falling back to pip. | Issue #12 (UX doctrine from #1: palette-first, no cascading menus; uv-only per product feedback) | Given the command runs, When a choice is made, Then `graphforge.pythonInterpreterPath` is set and/or `uv add graphforge` (in a uv project) or `uv pip install graphforge` runs only after an explicit confirmation dialog; if `uv` is missing, no install command runs and the user is directed to install uv. |
| FR-17 | The system shall detect Python interpreters in priority order: explicit config, VS Code Python extension selection, workspace venv (`.venv`/`venv`/`env`/`.conda`), then PATH. | Issue #12 | Given multiple candidates exist, When resolving, Then the first one with an importable `graphforge` wins. |
| FR-18 | The system shall classify the workspace as Python-first, Node-ish, or ambiguous based on Python markers (`pyproject.toml`, `requirements.txt`, `uv.lock`, `.python-version`, `Pipfile`, `environment.yml`, `setup.py`, notebook-dominant root, or an explicitly selected VS Code Python interpreter) versus Node markers (`package.json`), and use this to bias `graphforge.runtime: auto` toward Python in Python-first workspaces even when `@graphforge/node` is available. When both marker sets are present, Python wins only given a strong signal (`pyproject.toml`/`uv.lock`, or Python `graphforge` already usable); otherwise the workspace is ambiguous and Node stays the default. | Issue #12 (product feedback: Python-prefer in Python repos) | Given a workspace with `pyproject.toml` and no `package.json`, When `graphforge.runtime` is `auto` and both Node and Python are usable, Then Python is selected. Given a workspace with both `package.json` and `pyproject.toml`/`uv.lock`, When `auto` resolves, Then Python is still selected. An explicit `graphforge.runtime` of `node` or `python` always overrides project-kind detection. |

## Non-functional requirements

| ID | Quality attribute | Target / constraint | Why it matters |
|---|---|---|---|
| NFR-1 | Compatibility | VS Code `^1.96`, Node `>=20` | Aligns with engine Node bindings. |
| NFR-2 | Correctness boundary | No reimplementation of Cypher/verb/epistemic semantics in the extension (Node **or** Python path) | Engine is source of truth. |
| NFR-3 | Portability | Native addon resolved via optional peer, config path, or sibling monorepo | Dev and CI can work without published npm binary. |
| NFR-4 | License | Apache-2.0, publisher CurateLabs | Matches GraphForge engine. |
| NFR-5 | Default runtime | `@graphforge/node` remains the global default for Node-ish and ambiguous workspaces; Python is preferred in `auto` only for Python-first workspaces (or as a fallback when Node is unavailable), and an explicit `graphforge.runtime` setting always overrides project-kind detection | Issue #12 constraint from product. |
| NFR-6 | Fail-closed dual runtime | When neither runtime is usable, error messages and recovery actions must cover both setup paths | Issue #12 — no dead-end failures. |
| NFR-7 | Python packaging | Python setup/install flows use `uv` exclusively (`uv add` / `uv pip install`); the extension never shells out to `pip` and does not fall back to it when `uv` is missing | Ship policy — uv only, never pip. |

## Behavior trace

| Requirement | Given | When | Then |
|---|---|---|---|
| FR-4 | Folder with exact FORMAT marker | Discover projects | Project listed under Projects view |
| FR-2 | Open project + Cypher buffer | Run Query | JSON result document + optional graph panel |
| FR-7 | Graph payload with statuses | Show Result Graph | Nodes colored by epistemic status; legend lists statuses and types |

## Constraints & assumptions

- **Constraint:** Visualization colors for epistemic status are extension-owned (no product palette yet).
- **Constraint:** Committed ontology lives under `generations/<uuid>/participants/workspace/ontology.json`.
- **Assumption:** `@graphforge/node` returns Arrow IPC buffers decodable by `apache-arrow`, synchronously or as a Promise (knowledge-ledger writes are async `AsyncTask`s on the Node side as of this writing).
- **Assumption:** Identity UUIDs for assertions/evidence/confidence/status events must be UUIDv7 (engine-enforced); the extension mints them client-side via `session/uuid.ts`. Operation/idempotency UUIDs accept any version.
- **Constraint:** `recordAssertionStatus` requires an existing `provenanceUuid`; until there is a provenance picker, the analyst pastes one in directly (Advanced command).
- **Assumption:** Every knowledge-ledger native method is optional on `GraphForgeNative` and feature-detected at call time — the sibling engine API is still moving.

## Dependencies

- `@graphforge/node` — native engine facade (default runtime)
- `graphforge` (PyPI) + `pyarrow` — Python engine facade (alternative runtime, #12); resolved in
  a user-selected interpreter, never bundled with the extension
- `apache-arrow` — IPC table decode (shared by both runtimes)
- GraphForge engine project format and ontology participant layout

## Open questions

- Belief-projection policy defaults for statusless subjects in the graph UI — extension owners.
- Whether Marketplace publisher namespace is already claimed under CurateLabs — release owners.
