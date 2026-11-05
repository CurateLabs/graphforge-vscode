# Testing

## Packaged Hub clone storage qualification (#94)

The existing CI workflow has an opt-in `qualify_hub_clone` dispatch input. It builds
one VSIX, then installs those same bytes into fresh VS Code 1.142.0 profiles on
Linux, macOS, and Windows with a Node 22 test runner and the public Core
`0.6.0-rc.5` package. It exercises
the agent clone command, open, query, close, durable reopen, and the same query
again. Linux also verifies real tmpfs rejection and an absent destination. This
does not publish anything. Dispatch it on the exact branch or commit being
qualified; each host uploads a JSON report with the VSIX digest, versions,
platform, clone identity, and before/after result.

For a local run, use the command below (prefix with `xvfb-run -a` on headless Linux).
The evidence directory must be on storage Core admits. The runner requires network access to
the public package registry, VS Code downloads, and `graphforge.sh`; a download,
install, clone, or native-load failure fails the run. It uses the existing
`@vscode/test-electron` runner and removes only its own temporary profile/project.

```sh
npm run qualify:hub-clone -- /absolute/path/candidate.vsix /absolute/path/evidence
```

The current `opendata/openalex` fixture may be metadata-only. The test records its
actual node count and requires an identical result after reopen; a zero count
does not qualify #95's useful-result journey. These are extension-host storage and
identity checks: useful rendering and authenticated publish-back still need their
own actual-host evidence. The Dev Container lane below is the qualified remote host; WSL,
SSH, and tunnel sessions use the same `remoteName` path and are covered by unit tests only.
No runtime filesystem probe or fallback is added.

### Native Linux arm64 Core reproduction

The CI dispatch input `probe_core_arm64` runs the public Core `0.6.0-rc.5`
addon directly on `ubuntu-24.04-arm`, without VS Code. It preserves a
`core-arm64-probe` JSON artifact with the host, loaded addon hash, Core version,
destination filesystem, and clone exit/stdout/stderr. This isolates Core #2260
(VS Code #104) from Apple-silicon virtualization. A failing native clone fails
the job; ordinary PR checks do not run this operator probe.

The probe currently uses production's `openalex/openalex` identity because
`opendata/openalex` is not deployed there yet (Hub #215). Reconcile that input
with the migration before a later run; a missing repository cannot qualify
successful networking and cloning. This Core-only probe does not replace
the packaged native-arm64 Dev Container acceptance below.

### Remote extension host (Dev Container) lane

This proves that in a remote session the extension identifies the host where Core and
the destination actually run, and applies that host's storage rules (Linux
ext4/XFS/Btrfs guidance naming "the dev container"), not the desktop UI's (APFS). It is
local-only and not wired into CI: GitHub macOS runners have no Docker, and the point is a
non-Linux UI host driving a Linux engine. Linux CI already covers a Linux UI host.

Prerequisites: a macOS desktop with Docker Desktop running (its named volumes are ext4 and its
folder sharing is a non-admitted virtiofs mount, which the runner asserts), and network access to
npm, VS Code downloads, the Marketplace (Dev Containers), the container registry, and
`graphforge.sh`. Run it through npm, with a candidate VSIX and an evidence directory outside
the repository:

```sh
npm run qualify:hub-clone:dev-container -- /absolute/path/candidate.vsix /absolute/path/evidence
```

The container uses Docker's native architecture. Set
`GRAPHFORGE_QUALIFICATION_DOCKER_PLATFORM=linux/amd64` to run the engine host as Linux
x64 instead (emulated on Apple silicon); the report records the platform. On Apple silicon
the native `linux-arm64-gnu` Core `0.6.0-rc.5` build currently fails the Hub clone with
`hub.network` while x64 succeeds from the same host (#94 evidence). A native arm64 run
therefore ends `status: "failed"` at the clone step after its storage rejections pass; set
the x64 platform for a passing report until Core fixes that build.

The driver installs the VSIX and `ms-vscode-remote.remote-containers` into a fresh VS Code
1.142.0 profile, writes a throwaway `devcontainer.json` (Node 22 image, `node` user, Core
`0.6.0-rc.5` installed in the container, a new Docker named volume at `/gfwork`), and
opens that folder as a `dev-container+<hex>` remote URI. This runner file is the test
entrypoint inside the remote extension host. It requires `remoteName` to be
`dev-container` and the destination parent to be an admitted ext4 volume beneath a
different root filesystem, then runs clone, open, query, close, durable reopen, and the same
query again. Real `/dev/shm` (tmpfs) and macOS bind-mount (virtiofs) destinations must each
fail with `GF_UNSUPPORTED_FILESYSTEM`, Linux guidance naming the dev container, no
APFS/NTFS text, and no destination left behind. A failure of the bind-mount check is a Core
finding, not something to relax in the runner.

The report records the VSIX digest, versions (VS Code, Dev Containers, Core), UI host and
extension-host platform/arch/uid, statfs types, both rejections, clone identity, and node
counts. There is no CI artifact, so attach `report.json` to the tracking issue. The driver
removes its container (by Dev Containers label), volume, and work directory on exit, whether the
run passes or fails; the 25-minute watchdog removes the container to unblock a hung window.
`ELECTRON_RUN_AS_NODE` is cleared for the VS Code launch. Same fixture caveat: a zero node count is
storage and identity evidence, not #95 useful-result evidence.

## Local gates

### URI qualification (#88)

The [2026-10-23 receipt](./evidence/issue-88-uri-qualification.json) records a manual
run of the packaged extension at `9d2b109` in a fresh macOS arm64 VS Code 1.142.0
profile with public Node Core `0.6.0-rc.5`. Clicking the actual `vscode://` link in
VS Code's built-in Markdown preview reached the extension's confirmation and native
parent-folder picker. Cancelling confirmation or folder selection left no clone
destination and no open project. Confirming and selecting an empty parent cloned
the live `openalex/openalex` fixture and opened it; query, close, reopen, and the
same query passed with zero nodes both times.

This proves the extension's URI flow, not a browser-to-OS protocol association or
the production Hub's Open-tab button. The production page still exposes a CLI clone
command, and `opendata/openalex` still returns 404 there; Hub #215 owns that rollout.
The older fixture identity in this receipt records what was actually tested and
must not be rewritten after migration.

For a repeat, install the exact VSIX and Core candidate into a fresh profile,
configure the candidate's Node binding, put the Markdown link below in a file,
open its preview, and click it. Retain the one-time VS Code URI permission prompt and
the extension's own confirmation. Exercise both cancellation points before
selecting a fresh parent on admitted storage; verify the active project and
query/close/reopen through the existing commands. Record the VSIX hash, Core
version/source, host, URI, generation identity, and query comparison.

```markdown
[Clone from Hub](vscode://curatelabsai.graphforge/clone?repository=openalex%2Fopenalex)
```

#### Producing-version mismatch qualification

The [follow-up receipt](./evidence/issue-88-mismatch-qualification.json) completes
the authentic mismatch scenario on macOS arm64. Official Core `0.6.0-rc.6`
candidate artifacts at `2618813` cloned the unchanged native `opendata/openalex`
fixture produced by Core `0.6.0-rc.5` at `d5bbb93`. The exact preview deployment's
manifest and downloaded object hashes matched its pinned source artifacts.

The real native CLI returned exit 0, a `graphforge-hub-clone/1` receipt and
`GF_CORE_VERSION_MISMATCH` naming both versions. The actual extension mapper
preserved the warning with `graphforge.engineVersion`/Setup Native Binding and
matching-Python guidance. A second run clicked the URI in the same packaged
extension, confirmed, selected a fresh parent, showed that warning and guidance,
and opened the clone. Query, close, reopen and query again passed with zero nodes
both times. A warning alone did not turn success into failure.

The extension accepts the production Hub identity, so this preview qualification
used an external test binding wrapper. It forwarded the real candidate's exports
and added only Core's supported `--hub <exact-preview-deployment>` and
`--protection-bypass-env <variable-name>` arguments to clone calls; it returned
the native result unchanged. The existing Vercel automation credential was passed
only through the test process environment. Neither the extension's handler nor
the fixture metadata was modified. This is candidate/native consumer evidence,
not registry-package, browser protocol association, Hub-button or production
promotion qualification. The earlier partial receipt remains historical evidence.

For a repeat, verify the artifact ZIPs and fixture hashes in the receipt, load
that exact candidate, supply the existing preview credential through Core's
named environment-variable option, and run the same clone with the exact Hub
deployment. Check both native warnings and the extension's mapped next action;
for the interactive path, use the transparent argument wrapper described above
in a fresh profile and inspect the warning notification. Never relabel data to
substitute for this authentic different-producer scenario or weaken Core's public
HTTPS/storage admission checks to create a local clone fixture.

### Commands

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
| Result Graph | `src/test/xygRuntime.test.ts`, `extension.test.ts` | Native XYG composition, intent validation and command registration |
| Module activation | `src/test/extension.test.ts` | First-party module commands, exported registration API, and Module Bay command/panel activation |
| Results ↔ graph linking | `src/test/resultTableModel.test.ts`, `quickstart.e2e.test.ts` | Identity/endpoint matching plus the air-routes-scale integration path |
| XYG visualization | `xygRuntime.test.ts`, `quickstart.e2e.test.ts` | Native composition, actual four-view paint and PNG/SVG exports |

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
   `runProjectQuery` and opens all four saved XYG intents; asserts
   579 connected airports and 7,430 routes and structured panel success.

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

See [XYG integration](XYG.md) for current visualization lifecycle, native tests and bounded acceptance evidence.

The required Extension Development Host job should retain bounded construction,
reopen, schema, and lifecycle smoke coverage. Browser stress and comparative
performance remain opt-in evidence rather than a PR gate.

## XYG performance evidence

Native and browser engine benchmarks belong to XYG. This extension's tests
cover typed binding, persistence, cancellation and real paint acknowledgements.
A small passing sample does not establish massive-data or platform parity.

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

See [XYG integration](XYG.md) for current visualization lifecycle, native tests and bounded acceptance evidence.

## CI

`.github/workflows/ci.yml` runs on every PR and on push to `main`, on Blacksmith
(`blacksmith-4vcpu-ubuntu-2404`) runners, matching the runner convention used across the
CurateLabs/GraphForge repos:

| Job | Steps | Gate |
|---|---|---|
| `build` | `npm ci` → `npm run check` → `npm run compile` → `npm run test:unit` | Required. No Python or Electron needed; this is the fast, deterministic gate. |
| `vscode-test` | `npm ci` → `npm run compile` → `xvfb-run -a npm test` (Extension Development Host under Xvfb) | Required. Promoted to blocking after proving stable across CI runs (issue #24 host-switch gate) — it is the only automated detector for builds that compile green but fail to activate in a real VS Code window. |
| `package` | `npm ci` → `npm run compile` → `npm run package -- --no-dependencies` | Required. Proves the extension still packages; uploads the `.vsix` as a build artifact (not published — see `PUBLISHING.md`). |

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
