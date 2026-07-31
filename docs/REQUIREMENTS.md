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
- **Assumption:** `@graphforge/node` returns Arrow IPC buffers decodable by `apache-arrow`.
- **Assumption:** Knowledge ledger wiring beyond stub counts lands after scaffold.

## Dependencies

- `@graphforge/node` — native engine facade
- `apache-arrow` — IPC table decode
- GraphForge engine project format and ontology participant layout

## Open questions

- Belief-projection policy defaults for statusless subjects in the graph UI — extension owners.
- Whether Marketplace publisher namespace is already claimed under CurateLabs — release owners.
