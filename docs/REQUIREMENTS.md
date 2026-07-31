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

## Non-functional requirements

| ID | Quality attribute | Target / constraint | Why it matters |
|---|---|---|---|
| NFR-1 | Compatibility | VS Code `^1.96`, Node `>=20` | Aligns with engine Node bindings. |
| NFR-2 | Correctness boundary | No reimplementation of Cypher/verb/epistemic semantics in the extension | Engine is source of truth. |
| NFR-3 | Portability | Native addon resolved via optional peer, config path, or sibling monorepo | Dev and CI can work without published npm binary. |
| NFR-4 | License | Apache-2.0, publisher CurateLabs | Matches GraphForge engine. |

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

- `@graphforge/node` — native engine facade
- `apache-arrow` — IPC table decode
- GraphForge engine project format and ontology participant layout

## Open questions

- Belief-projection policy defaults for statusless subjects in the graph UI — extension owners.
- Whether Marketplace publisher namespace is already claimed under CurateLabs — release owners.
