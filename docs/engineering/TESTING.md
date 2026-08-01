# Testing

## Local gates

```bash
npm install
npm run check      # tsc --noEmit
npm run compile    # esbuild extension + tests
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

## Gaps (post-scaffold)

- Integration against a real `@graphforge/node` binary and sample project
- Webview message-protocol contract tests
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
