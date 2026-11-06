# Requirements

Contract for the GraphForge VS Code extension: editor workbench over the embedded
engine so analysts can run Cypher and analyst verbs, browse ontology and knowledge
context, and view epistemic-aware result graphs.

## Functional requirements

See [ADR-0006](engineering/adrs/0006-xyg-only-visualization.md) and the [XYG contract](engineering/XYG.md) for the current visualization boundary.

## Non-functional requirements

| ID | Quality attribute | Target / constraint | Why it matters |
|---|---|---|---|
| NFR-1 | Compatibility | VS Code `^1.96`, Node `>=20` | Aligns with engine Node bindings. |
| NFR-2 | Correctness boundary | No reimplementation of Cypher/verb/epistemic semantics in the extension (Node **or** Python path) | Engine is source of truth. |
| NFR-3 | Portability | Each platform VSIX bundles exact, lockfile-bound Core and XYG native packages plus the matching browser WASM/client cohort. Core resolves from an explicit config override, the bundle, node_modules, then a sibling build. | A clean install works without a separately configured Node binding; each supported platform is qualified independently. |
| NFR-4 | License | Apache-2.0, publisher CurateLabsAI | Matches GraphForge engine. |
| NFR-5 | Default runtime | `@curatelabs/graphforge` remains the global default for Node-ish and ambiguous workspaces; Python is preferred in `auto` only for Python-first workspaces (or as a fallback when Node is unavailable), and an explicit `graphforge.runtime` setting always overrides project-kind detection | Issue #12 constraint from product. |
| NFR-6 | Fail-closed dual runtime | When neither runtime is usable, error messages and recovery actions must cover both setup paths | Issue #12 — no dead-end failures. |
| NFR-7 | Python packaging | Python setup/install flows use `uv` exclusively (`uv add` / `uv pip install`); the extension never shells out to `pip` and does not fall back to it when `uv` is missing | Ship policy — uv only, never pip. |
| NFR-8 | Module safety | Side-loaded modules are declarative by default. A `workspace-script` entrypoint is allowed only when the machine-scoped `graphforge.modules.dangerouslyAllowWorkspaceJavaScript` user setting is explicitly enabled, VS Code trusts the workspace, the resolved `.js`/`.cjs` file remains inside the module folder, and the user accepts a per-install modal warning. Turning the setting off deactivates and disables installed workspace-script modules. Reserved GraphForge identifiers cannot be claimed by side-loaded providers. | A repository cannot grant itself extension-host code execution through workspace settings or path traversal. |
| NFR-9 | Module isolation | Every activation receives a scoped disposable store, and disabling or removing a module disposes only that module's registrations. | Modules must be independently controllable without leaking commands, listeners, or panels. |
| NFR-10 | Visualization safety | XYG intents are validated JSON only; no callbacks, `eval`, CDN, remote data fetch, implicit map provider, embedded credential, or broadened CSP. | A project artifact must not become code execution or covert network authority. |
| NFR-11 | Visualization ownership | XYG owns intent validation, schema recognition, composition, layout, ticks, painting and PNG/SVG export. | The extension transports data and owns VS Code lifecycle; it implements no alternate renderer. |
| NFR-12 | Performance evidence | Comparative stress work is opt-in and one-off, never a required PR/push/scheduled/release gate or an automatic renderer threshold. | Vendor or Node-preparation measurements do not prove browser rendering behavior. |
| NFR-13 | Supported Core | The extension declares the GraphForge Core version range it was qualified against in `package.json` (`graphforge.qualifiedCore.range`, shipped in the VSIX) and checks the resolved Node binding or Python `graphforge` against it. A loadable version outside the range (or an unreadable version) warns with `CORE_VERSION_UNQUALIFIED`; a version below `refuseBelow` is refused with `CORE_VERSION_UNSUPPORTED`. Both carry the observed version, the qualified range, and a next action naming `graphforge.engineVersion` or a matching Python environment; no result values. Check Environment and agent context expose the declaration and verdicts as `core`. The check compares one version string only: Core's own data/format and Hub version checks (Core #1769/#1936) are not duplicated. | Issue #95; consistent with xyg#936 (stable code, observed vs supported version, next action). |

## Behavior trace

See [ADR-0006](engineering/adrs/0006-xyg-only-visualization.md) and the [XYG contract](engineering/XYG.md) for the current visualization boundary.

## Constraints & assumptions

- **Constraint:** Visualization colors for epistemic status are extension-owned (no product palette yet).
- **Constraint:** Committed ontology lives under `generations/<uuid>/participants/workspace/ontology.json`.
- **Assumption:** `@curatelabs/graphforge` returns Arrow IPC buffers decodable by `apache-arrow`, synchronously or as a Promise (knowledge-ledger writes are async `AsyncTask`s on the Node side as of this writing).
- **Assumption:** Identity UUIDs for assertions/evidence/confidence/status events must be UUIDv7 (engine-enforced); the extension mints them client-side via `session/uuid.ts`. Operation/idempotency UUIDs accept any version.
- **Constraint:** `recordAssertionStatus` requires an existing `provenanceUuid`; until there is a provenance picker, the analyst pastes one in directly (Advanced command).
- **Assumption:** Every knowledge-ledger native method is optional on `GraphForgeNative` and feature-detected at call time — the sibling engine API is still moving.
- **Constraint:** A module's provider describes where it came from; capability
  (`query`, `visualize`, `import`, `integration`) describes what it adds. Neither is
  inferred from its installation method.
- **Assumption:** `GraphForgeNative.moduleCatalog()` is optional and may be absent
  or return no entries until engine-owned modules are registered by the GraphForge
  project.

## Dependencies

- `@curatelabs/graphforge` — native engine facade (default runtime)
- `graphforge` (PyPI) + `pyarrow` — Python engine facade (alternative runtime, #12); resolved in
  a user-selected interpreter, never bundled with the extension
- `apache-arrow` — IPC table decode (shared by both runtimes)
- XYG — exact source submodule, native engine and shared painter
- `koffi` — exact native FFI dependency used by XYG
- GraphForge engine project format and ontology participant layout
- Optional GraphForge engine module catalog (`moduleCatalog()`); absence is a
  supported compatibility state

## Open questions

- Belief-projection policy defaults for statusless subjects in the graph UI — extension owners.
- Whether Marketplace publisher namespace is already claimed under CurateLabsAI — release owners.
- Which engine-owned modules will be published through `moduleCatalog()` and how
  their version compatibility will be governed — GraphForge engine maintainers.
