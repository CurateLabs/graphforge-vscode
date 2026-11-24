# Release journeys: Hub round trip paired with Core 0.6.0

## Observed need and evidence

Issue [#95](https://github.com/CurateLabs/graphforge-vscode/issues/95) ships the extension
candidate paired with Core 0.6.0. Its acceptance asks for an installable VSIX that declares its
qualified Core and lets a user, or an agent, open a Hub repository, clone it with Core, reopen it,
query it, continue locally and publish back. Behavior for those steps has unit and
installed-package tests, spread across several suites. Before this document, no single set of
scenarios said which of them proves each step, or which steps no automated lane can prove.

## Desired user and business outcome

Someone installs the published VSIX and completes the Hub round trip without help. When a step
cannot proceed, the user and the agent both get Core's own code and message with a next action.
The extension adds no checks of its own that would contradict Core (ADR 0054).

## Users and context

- An analyst with VS Code and an in-editor coding agent, starting from a Hub link or the palette.
- The agent calling `graphforge.*` commands through `executeCommand`, as described in
  [agent-interop.md](./agent-interop.md).

## Intended behavior

The extension only orchestrates. Core runs `gf clone` and `gf publish` in-process and owns
admission, version and Hub semantics. XYG owns composition, painting and export.

## Given / When / Then scenarios

**Scenario R1: The installed build declares and verifies its qualified Core**
Given a platform-specific VSIX is installed in a fresh VS Code profile
When the agent calls `graphforge.checkEnvironment({ silent: true })`
Then the bundled Core binding loads with no separate install, its version equals the
`@curatelabs/graphforge` pin, `core.declared` equals `graphforge.qualifiedCore`, and
`core.node.status` is `qualified`.

**Scenario R2: A Core outside the qualified range warns or refuses with a stable code**
Given the resolved Core version is outside `graphforge.qualifiedCore.range`
When the extension opens an engine session
Then a loadable version warns with `CORE_VERSION_UNQUALIFIED`, a version below `refuseBelow`
refuses with `CORE_VERSION_UNSUPPORTED`, and both name `graphforge.engineVersion` or a matching
Python environment as the next action.

**Scenario R3: Clone a Hub repository, reopen it and get the same result**
Given an installed VSIX and an empty parent folder on storage Core admits
When the user opens a `vscode://curatelabsai.graphforge/clone?repository=…` link, or an agent calls
`graphforge.cloneFromHub({ repository, destination, open: true })`
Then Core clones the repository, the project opens, a query returns rows, and after
close and reopen the same query returns identical rows.

**Scenario R4: Invalid clone requests fail before Core runs**
Given an agent passes a malformed repository, a missing destination or mistyped arguments
When it calls `graphforge.cloneFromHub`
Then it receives `{ error, code, nextAction }` without a prompt and without network or disk work.

**Scenario R5: Filesystem admission reaches the user with host-specific guidance**
Given the destination is on storage Core does not admit
When the clone runs
Then Core's `GF_UNSUPPORTED_FILESYSTEM` code and message pass through verbatim, the guidance
names the volumes admitted on the engine host (the remote host in a Dev Container), and no partial
destination remains.

**Scenario R6: A producing-version mismatch is a warning, not a failure**
Given the Hub data was produced by a different Core version
When the clone completes
Then the outcome keeps Core's `GF_CORE_VERSION_MISMATCH` warning with producing and running
versions and matching-runtime guidance, in the agent result and in a user notification, and the
clone still succeeds.

**Scenario R7: Hub status codes pass through**
Given Core reports a Hub error such as a missing repository
When the clone or publish fails
Then the result keeps Core's semantic `hub.*` code and message and adds a next action.
Unstructured output does not become an invented code.

**Scenario R8: The documented query returns the documented result and the views paint**
Given a project with the air-routes sample data
When the user runs the documented query and opens graph, chart, map and timeline views
Then the Core Arrow result persists, each view reaches real XYG paint independently, and
reopening a saved view follows the same readiness lifecycle.

**Scenario R9: Painted views export offline HTML**
Given a ready XYG graph, chart or timeline
When the user calls `graphforge.exportVisualization({ format: "html" })` or selects Save HTML
Then a self-contained HTML file is written to `visualizations/exports`, and a repeated export gets a
new filename instead of overwriting the earlier one.
Maps export PNG/SVG only. Static time-axis PNG/SVG export is refused with
`XYG_SCENE_UNSUPPORTED_PUBLIC_AXIS`.

**Scenario R10: Agent publishes require explicit confirmation**
Given an agent calls `graphforge.publishToHub` with a repository, a Branch and a project path
When it omits `confirm: true`
Then it receives `CONFIRMATION_REQUIRED`, and the suggested retry names the same project.
Core is not called.

**Scenario R11: Publishing refuses previews and a missing project before Core runs**
Given an agent asks to publish previews, or no project is open and none is named
When it calls `graphforge.publishToHub({ …, confirm: true })`
Then it receives `HUB_PUBLISH_PREVIEWS_UNAVAILABLE` or `HUB_PUBLISH_PROJECT_REQUIRED` with a next
action.

**Scenario R12: A missing Hub credential returns Core's next action**
Given no `GRAPHFORGE_HUB_PUBLISH_TOKEN` and no Core login
When a confirmed publish runs
Then Core's credential-required error and its next action pass through unchanged, and the
extension stores no credential.

**Scenario R13: A taken publish ID is recovered without guessing**
Given Core refuses a publish with `hub.publish.id_taken`
When the user follows the recovery
Then organization recovery comes first. Regeneration needs a modal confirmation and runs only
Core's rewrite command before it offers the same Branch for publication. Exact-Version recovery
refuses before any prompt.

**Scenario R14: Publish back to the production Hub**
Given a cloned project with new local research and a valid Core Hub credential
When the user publishes the research Branch to a repository they own
Then the production Hub shows the new revision, and a fresh clone of it reopens with the same
result.

## Scenario-to-test map

"PR CI" runs on every pull request and push to `main`. "Dispatch" runs only on a manual
`workflow_dispatch` of `CI` with the named input. "Human" has no automated lane.

| Scenario | Executable evidence | Lane |
|---|---|---|
| R1 | `src/test/releaseJourneys.test.ts` (bundled Core qualified); `src/test/coreQualification.test.ts` (bundled Core exact and in range); `scripts/qualify-installed-xyg.cjs` (installed VSIX, Core version equals the pin) | PR CI: Extension Development Host tests, unit tests, Packaged XYG (5 platforms) |
| R2 | `src/test/coreQualification.test.ts`; `src/test/versionDiscovery.test.ts` | PR CI: unit tests |
| R3 | `scripts/qualify-hub-clone.cjs` (installed VSIX, production Hub clone, query, close, reopen, identical rows); `src/test/hubClone.test.ts` (argv and receipt mapping) | Dispatch `qualify_hub_clone` (Linux, macOS, Windows); unit tests. The dispatch installs the one VSIX built on Linux on all three hosts, so only its Linux job exercises a matching platform package; macOS and Windows clone evidence on their own packages is pending until the lane downloads a per-platform VSIX. The `opendata/openalex` fixture may be metadata-only, so a zero count proves identity and durability, not a useful result. |
| R4 | `src/test/extension.test.ts` (`Hub clone agent argument validation`); `src/test/hubClone.test.ts` | PR CI |
| R5 | `src/test/hubClone.test.ts` (`filesystem admission (#94)`); `scripts/qualify-hub-clone.cjs` (real tmpfs rejection); `scripts/qualify-hub-clone-remote.cjs` (Dev Container) | Unit tests; dispatch; Dev Container lane is local-only |
| R6 | `src/test/hubClone.test.ts` (`interpretHubCloneResult`); [mismatch receipt](../engineering/evidence/issue-88-mismatch-qualification.json) | Unit tests; recorded receipt from an earlier commit |
| R7 | `src/test/hubClone.test.ts`, `src/test/hubPublish.test.ts` (semantic code preference, unstructured fallback) | Unit tests |
| R8 | `src/test/quickstart.e2e.test.ts` (`Core query → persisted Arrow → independent XYG graph/chart/map/timeline`), also run against each installed VSIX | PR CI: Extension Development Host tests, Packaged XYG |
| R9 | `src/test/quickstart.e2e.test.ts` (HTML export and repeated-export preservation) | PR CI: Extension Development Host tests, Packaged XYG |
| R10 | `src/test/releaseJourneys.test.ts`; `src/test/hubPublish.test.ts` (`requirePublishConfirmation`) | PR CI |
| R11 | `src/test/releaseJourneys.test.ts`; `src/test/hubPublish.test.ts` (`buildHubPublishArgs`) | PR CI |
| R12 | `src/test/hubPublish.test.ts` (real Core credential-required stderr) | Unit tests |
| R13 | `src/test/hubPublish.test.ts` (`Taken-ID publish recovery (#103)`); `scripts/qualify-hub-publish-recovery.cjs` (real native refusal, intercepted publish boundary) | Unit tests; the installed recovery runs only locally, when `GRAPHFORGE_QUALIFICATION_RECOVERY_FIXTURE` names a fixture. The CI dispatch sets none. |
| R14 | None. It needs a real credential and writes to the production Hub. | Human |

## Human checklist before announcing a release

Automated lanes cannot prove these, so they are not mocked:

1. The Core #1209 journey in a fresh desktop VS Code with an agent, using the published VSIX:
   open the public fixture link, clone, reopen, run the documented query, compare the documented
   result, and continue locally.
2. R14, publishing back to the production Hub with Core's credential flow.
3. A useful-result clone (R3) once the Hub fixture carries data, not only metadata.

## Constraints and domain language

- **Qualified Core**: the range in `package.json#graphforge.qualifiedCore`, shipped in the VSIX.
- **Branch / Version**: a research Branch label (`ref`) or an exact research Version
  (`versionUuid`), as in Core.

## Success signals and telemetry

- Every PR CI row in the map is green at the release commit.
- The dispatch `qualify_hub_clone` run at the release commit is green on Linux. Its macOS and
  Windows jobs count as release evidence only once the lane installs each host's own platform VSIX;
  until then the five `Packaged XYG` jobs are the per-platform package evidence.

## Open questions

- Which Hub fixture with real data replaces the metadata-only `opendata/openalex` for R3.

## Related requirements, tests, architecture, and ADRs

- Requirements: [NFR-3, NFR-13](../REQUIREMENTS.md); issues #88, #91, #94, #95, #103.
- Testing lanes: [TESTING.md](../engineering/TESTING.md), [XYG qualification](../engineering/XYG_QUALIFICATION.md).
- Architecture: [Supported-Core declaration](../engineering/ARCHITECTURE.md#supported-core-declaration-95).
