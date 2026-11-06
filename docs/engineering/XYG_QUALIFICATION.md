# XYG acceptance matrix

The extension owns this acceptance matrix and its integration tests. Core owns
schema facts and computations; XYG owns dispositions, composition, geometry,
layout, paint and export. This document does not author a second result ledger.

## Required automated lanes

| Acceptance | Gate and evidence |
| --- | --- |
| Complete live Core catalog coverage (#90) | `scripts/xyg-coverage.mjs` compares every `algorithmDescriptorContracts()` entry with `graphforgeLedger()`, including schema versions and unique disposition ownership. Negative regression tests add a new algorithm and change a schema version. |
| Real result-family composition (#80) | `scripts/qualify-xyg.mjs` consumes the pinned XYG Core-produced fixture corpus for all live contracts and every permitted intent. It records the corpus producer separately from the live Core version. |
| Native/WASM agreement (#80) | Identical request framing and full composition-document bytes, including UUID/result-row membership, rendered bounded Scenes, stale joins and missing embedding-coordinate failures. Missing WASM, an ABI/version mismatch or unavailable native library fails the lane. |
| Clean offline-capable package (#82) | Per-platform VSIX contains exact Core, XYG native library, browser WASM/worker, painter and notices. Registry integrities and native/WASM hashes bind the artifacts. No external Core path is configured by the installed runner. |
| Actual platform/architecture (#82) | `XYG qualification` workflow runs Linux x64/arm64, macOS x64/arm64 and Windows x64. Every lane asserts its actual process platform before building and installs only its own platform VSIX. |
| Installed desktop behavior (#82) | Original Arrow persistence, canonical edit/reopen, graphs/charts/maps/timelines, explicit analytical charts, no-write table-only failure, exports and explicit time-axis export limit, four themes, reduced motion, retained hidden views, split resize and saved-result reopen without rerunning its query. |
| Actionable schema failures (#80) | Table-only intent reports `XYG_TABLE_ONLY` with the Results action. Embedding coordinates are never guessed. Unknown/stale/version-mismatched schemas retain XYG's failures. |
| Package resource bounds (#82) | At most 240 files and 256 MiB unpacked. The larger bound includes the full Core native engine. Each lane attaches its exact VSIX and value-free `installed.json`, `report.json` and `scenarios.json`. |

Run locally after compilation:

```sh
npm run qualify:xyg -- "$PWD/dist/core/node_modules/@curatelabs/graphforge" /tmp/xyg-schema-evidence
npm run package -- --no-dependencies -o /tmp/graphforge-platform.vsix
npm run qualify:xyg:installed -- /tmp/graphforge-platform.vsix /tmp/xyg-installed-evidence
```

Linux desktop runs need Xvfb (`xvfb-run -a npm run qualify:xyg:installed -- …`).
The runner uses a separate VS Code profile and extensions directory and removes
them afterward. Reports contain versions, codes, schema IDs, counts, hashes,
sizes and timings; they contain no source rows, coordinates or embedding values.

## Gates that cannot be inferred from those lanes

- Remote extension-host acceptance runs the appropriate Linux VSIX in the
  real remote host, with paint reaching the desktop client. On macOS with
  Docker Desktop, after downloading the matching Linux artifact from the same
  candidate's platform workflow, run:
  `GRAPHFORGE_QUALIFICATION_SUITE=xyg npm run qualify:hub-clone:dev-container -- <Linux VSIX> <evidence directory>`.
  The existing Dev Container driver stages the Linux package for the remote
  development host, uses bundled Core and an admitted named volume for project
  storage, and runs the same installed paint/reopen/theme/resize scenarios.
  The runner asserts `vscode.env.remoteName === "dev-container"` and Linux.
  A local container process or headless Node/WASM comparison is not this proof.
- Keyboard-only and screen-reader companion behavior needs rendered accessibility
  evidence. Source checks and theme paint acknowledgements do not certify WCAG.
- Temporal intervals, playback, streaming/LOD, coordinated time-filtered graphs,
  and temporal/spatial selections require their actual XYG contracts and fixtures;
  the sample's UTC line chart does not stand in for them.
- XYG currently rejects time-axis PNG/SVG export with
  `XYG_SCENE_UNSUPPORTED_PUBLIC_AXIS`. The extension exposes that limitation and
  does not substitute a different axis. Full temporal export acceptance is open.
- Small/medium/large/massive preparation, layout, paint, interaction, memory,
  payload and export budgets need measured scale receipts on the final package.
  The fixture corpus and the 579-node sample are not massive-data evidence.
- The Core-produced corpus has its own recorded Core version. Agreement with
  a newer catalog does not requalify every algorithm implementation on that
  newer Core release or update XYG's compatibility declaration.

Issues #80 and #82 close only when their remaining acceptance has real evidence.
Issue #90's implementation is the ownership pointer plus the required live-catalog
coverage gate; no authored disposition list is retained here.
