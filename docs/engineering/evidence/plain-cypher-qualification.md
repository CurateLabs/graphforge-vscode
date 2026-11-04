# Plain-Cypher qualification

Bounded local verification on macOS arm64, 2026-11-03. Extension baseline:
`7ecfb7b`; XYG baseline: `14e944b1b1e931e1e270d023c5b8fa5c5dce2d8d`.
The local XYG repair is `18951e621e875407d0e40c35ccddf12d4b1a8def`, on
`fix/plain-cypher-code-captions`.

## Findings and changes

The old zero-layer rejection is already removed. Canonical Core
`MATCH (a)-[r]->(b) RETURN a,r,b` flows into XYG as original Arrow IPC,
without an analytical layer or a host graph reconstruction.

The current extension quickstart seed already sets `name` to the airport code.
Its MHK caption is not the code-only defect below. The standalone seed script
and external/older projects can supply Airport entities with `code` and no
name/title/label; fresh Core 0.6.0-rc.7 output reproduces that shape.

Three gaps were reproduced and repaired:

- XYG's shared Rust base collector omitted `code` from caption candidates.
  It now follows `name`, `title`, `label`, `code`, then short UUID identity.
  Existing name precedence, UUID identity and property rows are preserved.
- A typed zero-row entity result failed with `GF_BASE_EMPTY`. Valid empty
  entity tables now compose normally; schema, endpoint and generation
  validation remain active. Native one-shot/progressive layout now accepts
  null coordinate buffers only for zero nodes. Native render allocation also
  agrees with the hosts' zero-node output capacity. No host fallback or new
  ABI signature is introduced.
- The extension dropped `result.generationUuid` from plain graph requests.
  `graphInput` now forwards it, as it already does for analytical inputs.

XYG owns the implementation and its schema-faithful generated Arrow fixtures.
The extension changes only the binding, its regression and documentation.
Neither immutable product-boundary document nor the parent worktree was edited.

## Proof

- `cargo test -p xyg-engine graphforge:: -- --nocapture`: 201 passed.
- `cargo test -p xyg-core graph_ -- --nocapture`: 5 passed, including
  zero-length coordinate handling and rejection of missing live handles,
  non-empty null buffers and missing alpha outputs.
- With `XYG_NATIVE_LIB=$PWD/target/release/libxyg_core.dylib`,
  `node --test packages/xy-node/test/graphforge{,-layout,-wasm-parity,-cross-host}.test.mjs`:
  54 passed, no skips. Covers original property defaults, loops/parallel UUIDs,
  directed arrow policy, generation errors, native/WASM byte identity,
  Python-pinned cross-host bytes, live cancellation and late-response rejection.
- With the same native-library environment, `uv run pytest tests/test_graphforge.py
  tests/test_graphforge_fixture_generation.py -q`: 24 passed. Additional direct
  Python code-only and empty-chart exports produced identical repeated PNG/SVG
  bytes.
- `python3 scripts/gen_abi_manifest.py --check`: current, 537 symbols, ABI 398.
- Full-worktree `uv run --with pre-commit pre-commit run --all-files`,
  `uv run ruff check .`, and `uv run ruff format --check .`: passed before
  the XYG commit.
- `npm run check` and `npm run test:unit`: passed; 280 unit tests passed,
  one optional sibling Python-interpreter probe pending.
- `quickstart.e2e.test.ts` in the installed VS Code application, loading this
  development extension with fresh user-data and extensions directories:
  1 passed in 22 seconds. Real webviews acknowledged graph/chart/map/temporal
  paints; persisted Arrow reopen, direct graph, canonical UUID edit and
  supported export checks passed. This is an extension-host test, not a new
  packaged VSIX qualification. Harness/log:
  `/tmp/graphforge-plain-cypher-fd8c-{run-host,host-tests}.cjs`,
  `/tmp/graphforge-plain-cypher-fd8c-host.log`.

The adjacent [machine report](plain-cypher-qualification.json) comes from:

```sh
node scripts/qualify-plain-cypher.mjs /path/to/@curatelabs/graphforge \
  docs/engineering/evidence/plain-cypher-qualification.json
```

It creates and removes its own temporary Core project. It verifies nodes-only,
node/relationship results, one loop plus two parallel relationships, both
forms of empty result, exact source UUID sets, direction, completion of native
CoSE layout, repeatable positions and PNG/SVG bytes, and generation/UUID
preservation after closing and reopening Core. Reports contain counts and
hashes, without source rows/properties.

## Limits

Determinism is proved for identical canonical Arrow input and generation.
Fresh Core queries can reorder relationships after reopen; identity is compared
as UUID sets for that separate check. Saved Arrow retains its original order.
XYG's existing label culling can omit a caption near a plot edge; caption
selection and caption visibility are separate policies. This change adds no
visibility or styling override.

Live GitHub reads showed XYG #934 CLOSED and extension #80 OPEN. The closure
state is not full release evidence: merged XYG #1086 explicitly records remaining
interactive/static presentation differences, and the pinned spec retains
keyboard/zoom acceptance limits. This task does not qualify those gates,
temporal export (#889), every algorithm schema, massive graphs, other platforms,
or unpublished packages. No PR, merge, publication or issue-state change was made.
