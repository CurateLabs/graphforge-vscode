# Testing

## Local gates

```bash
npm install
npm run check      # tsc --noEmit
npm run compile    # vite: extension host + test bundles + webview UI
npm run test:unit  # FORMAT detector (plain mocha, no Electron)
npm test           # @vscode/test-cli (Extension Development Host)
```

Requires `@vscode/test-electron` ≥ 3.1.0 on macOS (VS Code 1.110+ ships `Code` instead of `Electron`).

## What we prove now

| Area | Test | Notes |
|---|---|---|
| Project detection | `src/test/projectDetector.test.ts` | Exact FORMAT bytes; CURRENT parse |
| Activation | `src/test/extension.test.ts` | Extension id, core commands (incl. `setupPythonBinding`), `cypher` language |
| Environment reporting | `src/test/environmentReport.test.ts` | Dual-runtime next-action logic + 3-line summary format |
| Runtime selection | `src/test/runtimeSelection.test.ts` | `chooseRuntime` auto/node/python precedence incl. project-kind bias; `describeRuntimeUnavailable` mentions both setup paths |
| Project-kind detection | `src/test/projectKind.test.ts` | `detectProjectKind` heuristic (Python/Node/ambiguous markers, both-present tie-break) and `isNotebookDominant` |
| Python interpreter probe | `src/test/pythonProbe.test.ts` | Nonexistent interpreter, `graphforge` not importable, and (when the sibling `graphforge/.venv` dev venv exists) a real successful import + version |
| Python bridge protocol | `src/test/pythonBridge.test.ts` | Framing/id-correlation/error-marshalling against a fake Node-run host (`fixtures/fakeGraphforgeHost.js`); `PythonEngineBackend` contract |
| Python quickstart paths | `src/test/quickstartSample.test.ts`, notebook `nbformat` validation, and Python syntax compilation | Notebook v4 structure, Streamlit app source, shared dataset counts, native Python bulk construction/PageRank, and portable CSV/HTML/browser outputs |
| Module manifests | `src/test/moduleManifest.test.ts` | Entrypoint parsing, malformed/unknown-capability rejection, context-key derivation, and workspace-script path-shape rejection |
| Import module | `src/test/importData.test.ts` | CSV/JSON/JSONL parsing, format inference, Cypher identifier escaping, create/merge query shape, duplicate headers, and reserved property keys |
| Result Graph | `src/test/resultGraphModel.test.ts`, `settingsSchema.test.ts`, `extension.test.ts` | Renderer default/options, styling helpers, selection-message resolution, live setting-switch host smoke |
| Module activation | `src/test/extension.test.ts` | First-party module commands, exported registration API, and Module Bay command/panel activation |
| Results ↔ graph linking | `src/test/resultTableModel.test.ts`, `quickstart.e2e.test.ts` | Identity/endpoint matching plus the air-routes-scale integration path |
| Visualization artifacts (#67) | `src/test/projectArtifacts.test.ts`, `settingsSchema.test.ts`, `quickstartSample.test.ts` | v1 read compatibility; strict v2 validation; Cytoscape/Plotly graph/chart defaults; explicit G6/G2/L7 alternatives, bindings, coordinates, and time configuration; project-owned sample artifacts |

### Python runtime testing notes (#12)

- `pythonBridge.test.ts` runs the real `PythonBridge`/`PythonEngineBackend` TypeScript logic
  against a **fake** host script executed via `process.execPath` (the current Node binary), so
  the suite proves the wire protocol and error handling without requiring Python or `graphforge`
  in CI.
- `pythonProbe.test.ts`'s "graphforge is importable" case only runs when a sibling
  `../graphforge/.venv/bin/python3` exists (this repo's local dev setup); it's skipped (not
  failed) elsewhere. To run it locally, build the sibling `graphforge` dev venv per that repo's
  README, then rerun `npm run test:unit`.
- **Manual/CI-optional matrix:** exercise `python/graphforge_host.py` directly against a real
  `graphforge` (PyPI or dev venv) interpreter for a true end-to-end check — spawn it, send
  `open`/`execute`/`verb`(rank)/`close` over stdin, and confirm Arrow IPC comes back on stdout.
  This was done manually during #12 development against `graphforge 0.5.0-dev`; `labels()` /
  `relationship_types()` currently raise `NotImplementedError` server-side (tracked as a known
  gap in `docs/engineering/ARCHITECTURE.md`), everything else round-trips correctly.

## Quickstart e2e (#63)

`src/test/quickstart.e2e.test.ts` runs under `npm test` (Extension Development Host):

1. Skips when `openSampleProject` returns `RUNTIME_UNAVAILABLE` (no peer / sibling binding).
2. When available: seeds the vendored **US air-routes** dataset, asserts
   project-owned query/visualization/mutation files exist, then runs
   `runProjectQuery` and reopens both saved visualization specs; asserts
   airport/route scale (≥500 nodes, ≥7000 edges) and structured panel success.

Unit coverage: `quickstartSample.test.ts` (CSV + materialized artifact layout),
`projectArtifacts.test.ts` (schemas/read-write/filter/traversal), and
`getStartedContent.test.ts` (`buildChecklistSteps`). Smoke outside VS Code:
`node scripts/seed-quickstart-sample.mjs [dir]`.

CI’s required `build` job does **not** install the native peer; the e2e case is
expected to skip there. Local/dev hosts with a sibling
`../graphforge/crates/graphforge-bindings-node` (or installed peer) should see it pass.

## Visualization Extension Development Host matrix (#67)

Run the packaged extension in light, dark, and high-contrast themes. Keep the
developer console open to catch CSP and worker errors.

1. Create a Result Graph through the normal UI. Inspect its saved v2 artifact and
   confirm it explicitly records G6, Canvas, ForceAtlas2 worker execution,
   animation, styling, interaction, and filters before the panel opens.
2. Reopen the artifact, change the global default, and reopen it again. The saved
   renderer and behavior must not change. Then create a new artifact and confirm
   only the new file uses the changed creation default.
3. Open committed v1 Cytoscape, Sigma, and Plotly fixtures. Confirm they render
   without rewriting their bytes. Exercise pan, zoom, Fit, Re-layout, selection,
   and linked Results behavior for each applicable graph renderer.
4. Create and reopen a G2 analytical artifact with explicit encodings,
   transforms, filters, scales, and presentation. Exercise the retained raw
   Plotly preview and confirm it is visibly unsaved until **Save visualization**
   creates a project artifact.
5. Create and reopen L7 geospatial artifacts with explicit point coordinates,
   source/target link coordinates, or GeoJSON binding, plus CRS, projection,
   layer order, blank offline basemap, and viewport. For the airport-route sample,
   confirm every valid route row produces an arc and the point layer contains the
   unique source/target endpoints. Disable the network and confirm there are no
   fetch attempts, tokens, CSP violations, or hidden remote tiles.
6. Create and reopen a G2 temporal artifact with explicit timestamp, timezone,
   granularity, range, aggregation, and playback. Enable G6 Timebar only through
   explicit graph bindings; a date-like column alone must not create one.
7. Change material UI state, verify a visible dirty state, then exercise Save and
   Revert. Reload the Extension Development Host and confirm saved state reopens
   while hover, transient selection, and the current playback frame do not become
   persistent accidentally.
8. Force G6, G2, L7, Sigma, and Plotly construction failures. Confirm a stable
   `renderFailed` code and next action, the original artifact remains unchanged,
   and no renderer, backend, layout, field, sampling, or projection fallback
   occurs.
9. Use keyboard-only navigation and a screen reader to verify controls, textual
   summary, underlying rows/entities, current filters/range, and selection
   details. Enable reduced motion and confirm layout animation, playback, and
   transitions respect it.
10. Run the quickstart's graph, analytical, geospatial, and temporal artifacts at
    the documented air-routes scale. Confirm lifecycle ordering and usable
    interaction; record browser renderer/layout timings separately from the
    preparation-only benchmark below.
11. For G6 Canvas, confirm `renderReady` follows layout, fit, two browser paint
   frames, and a non-empty Canvas pixel check. A scene that remains interactive
   through hit-testing but paints no pixels must report `GF_G6_CANVAS_EMPTY` (or
   `GF_G6_CANVAS_RENDER_ERROR` for an asynchronous renderer exception), never
   readiness. The medium sample keeps all 579 nodes and 7,430 edges while its
   artifact explicitly disables edge labels and arrowheads.
12. For G6, Cytoscape, Sigma, G2, L7, and Plotly, confirm the provisional output
   stays covered while rendering. Verify the visible and screen-reader status
   names the selected renderer and advances through its truthful data,
   layout/composition, and paint stages without a fabricated percentage. The
   overlay must clear only after readiness and remain as an actionable failed
   stage when rendering fails.

The required Extension Development Host job should retain bounded construction,
reopen, schema, and lifecycle smoke coverage. Browser stress and comparative
performance remain opt-in evidence rather than a PR gate.

## Opt-in visualization benchmark (#67)

Run the existing package script manually:

```bash
npm run benchmark:visualizations -- --layout-tier all --output /tmp/graphforge-viz-benchmark.json
```

`scripts/benchmark-visualizations.mjs` uses identical deterministic payloads for
G6, Cytoscape, and Sigma at three tiers: generated small, the vendored real
air-routes sample as medium, and generated large. The JSON report records exact
renderer/backend/layout configuration, node/edge counts, preparation timing,
serialized bytes, a checksum, and optional Node layout timing. Layout algorithms
run in isolated workers with a configurable, recorded 60-second default budget;
a large layout that exceeds the budget is recorded as timed out rather than
hanging the benchmark or changing a product default.

This is **Node preparation and algorithm evidence only**. Heap delta is recorded
where available, not peak memory. It does not construct a browser renderer or
measure Canvas/WebGL paint, browser worker/WASM behavior, interaction, playback,
CSP, browser peak memory, or accessibility. Use the Extension Development Host
matrix for those claims.

The script must remain absent from `compile`, `test`, `test:unit`, prepublish,
PR, push, scheduled, required, and release workflows. Its output is local evidence
to attach to the implementation PR, not a committed product default or an
automatic renderer-selection threshold.

## Module Bay manual EH matrix

Run the Extension Development Host in light, dark, and high-contrast themes:

1. Open **GraphForge: Manage Modules** and confirm Query, Visualize, and Import
   appear as installed **Default module** cards, with source/version/status and no
   Remove action. The activation test pins all three as installed and non-removable.
2. Disable and re-enable each first-party module. Confirm only that module's
   command/action becomes unavailable and returns without an extension-host reload.
3. With a binding that implements `moduleCatalog()`, refresh discovery and confirm
   catalog entries appear as GraphForge modules, can be installed, and can be
   enabled or disabled. Repeat with an older binding and confirm the bay remains
   usable with no catalog entries.
4. Side-load a valid declarative manifest, then try an invalid manifest and one
   claiming a reserved `graphforge.*` identifier. Confirm the valid module can
   reference only an already-registered command and both invalid manifests fail.
5. Try a `workspace-script` module with the dangerous setting off, from an
   untrusted workspace, with a path escape/symlink escape, and after cancelling
   the modal warning. Confirm no code runs. Then enable the user-level setting,
   trust the workspace, accept the warning for reviewed code, and confirm its
   scoped activation and deactivation. Turn the setting off and confirm the
   module is immediately disabled.
6. Exercise filters, switches, actions, and focus order with keyboard only; resize
   the panel and enable reduced motion to confirm the responsive/accessibility
   behavior remains intact.

## Remaining test gaps

- Optional CI job that installs `@curatelabs/graphforge` and fails if quickstart e2e skips
- Browser-level automation for canvas/WebGL interaction and CSP console violations
- Automated browser-level G6/G2/L7 interaction, accessibility, and renderer-memory evidence
- Browser-level automation for Module Bay filtering, keyboard behavior, themes,
  and host-authoritative action refreshes
- Integration coverage for module activation/deactivation disposal, side-load
  persistence, and the optional engine catalog lifecycle
- Verb QuickPick → IPC round-trip with fixtures
- `GraphForgeSession`/command-layer tests against a fake `EngineBackend` (currently only the
  lower-level bridge/probe/selection logic has direct unit coverage; session wiring is exercised
  indirectly via `extension.test.ts`'s command-registration check)
- Automated Python interpreter-detection tests (`collectPythonCandidates`,
  `detectPythonExtensionInterpreter`) require the `vscode` API and are only exercised by manual
  Extension Development Host runs today, not `npm run test:unit`
- Same gap for `projectKindDetector.ts`'s `detectWorkspaceProjectKind`/`collectProjectKindSignals`
  (filesystem probing is fine under plain mocha, but it calls the `vscode`-dependent
  `detectPythonExtensionInterpreter` for the "interpreter selected" signal) — the pure
  classification logic it delegates to (`detectProjectKind`, `isNotebookDominant` in
  `projectKind.ts`) has full unit coverage instead

## CI

`.github/workflows/ci.yml` runs on every PR and on push to `main`, on Blacksmith
(`blacksmith-4vcpu-ubuntu-2404`) runners, matching the runner convention used across the
CurateLabs/GraphForge repos:

| Job | Steps | Gate |
|---|---|---|
| `build` | `npm ci` → `npm run check` → `npm run compile` → `npm run test:unit` | Required. No Python or Electron needed; this is the fast, deterministic gate. |
| `vscode-test` | `npm ci` → `npm run compile` → `xvfb-run -a npm test` (Extension Development Host under Xvfb) | Required. Promoted to blocking after proving stable across CI runs (issue #24 host-switch gate) — it is the only automated detector for builds that compile green but fail to activate in a real VS Code window. |
| `package` | `npm ci` → `npm run compile` → `npx vsce package --no-dependencies` | Required. Proves the extension still packages; uploads the `.vsix` as a build artifact (not published — see `PUBLISHING.md`). |

The `pythonProbe.test.ts` "graphforge is importable" case only runs when a sibling
`../graphforge/.venv` dev venv exists, so it's automatically skipped (not failed) in CI,
per the notes above.

To reproduce CI locally:

```bash
npm ci
npm run check && npm run compile && npm run test:unit
xvfb-run -a npm test   # Linux only; on macOS/Windows just `npm test`
npx vsce package --no-dependencies
```

# Visualization lifecycle

`visualizationInstanceRegistry.test.ts` is the fast contract gate for
multi-instance ownership, stable private saved identities, explicit
coordination groups, stale-generation rejection, superseded-work cancellation,
and deterministic disposal. Webview typechecking additionally verifies that
graph, artifact, and figure messages carry the instance/revision context.
