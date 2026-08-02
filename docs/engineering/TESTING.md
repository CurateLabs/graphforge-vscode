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
| Module manifests | `src/test/moduleManifest.test.ts` | Entrypoint parsing, malformed/unknown-capability rejection, context-key derivation, and workspace-script path-shape rejection |
| Import module | `src/test/importData.test.ts` | CSV/JSON/JSONL parsing, format inference, Cypher identifier escaping, create/merge query shape, duplicate headers, and reserved property keys |
| Result Graph | `src/test/resultGraphModel.test.ts`, `settingsSchema.test.ts`, `extension.test.ts` | Renderer default/options, styling helpers, selection-message resolution, live setting-switch host smoke |
| Module activation | `src/test/extension.test.ts` | First-party module commands, exported registration API, and Module Bay command/panel activation |
| Results ↔ graph linking | `src/test/resultTableModel.test.ts`, `quickstart.e2e.test.ts` | Identity/endpoint matching plus the air-routes-scale integration path |

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

## Result Graph manual EH matrix (#65)

Run the Extension Development Host in both light and dark themes:

1. Open an epistemic payload and a class-only payload with Cytoscape; verify legends,
   banner/empty states, pan, zoom, Fit, Re-layout, node inspect, and edge inspect.
2. Keep the panel open and change **Result Graph renderer** to Sigma in GraphForge Settings;
   verify the same payload re-renders without reloading the host and repeat the interactions.
3. Run the quickstart air-routes query (roughly 586 nodes / 7.4k edges) in both renderers;
   verify layout completes and pan/zoom remains usable. Large-graph label/arrow reduction is
   expected.
4. Disable WebGL (or use a host without it), select Sigma, and verify the in-panel fallback
   banner appears and Cytoscape renders the retained payload.
5. Confirm both Get Started result CTAs still open distinct panels: Result Graph uses the
   selected graph renderer and Figure remains Plotly.

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

## Gaps (post-scaffold)

- Optional CI job that installs `@curatelabs/graphforge` and fails if quickstart e2e skips
- Browser-level automation for canvas/WebGL interaction and CSP console violations
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
