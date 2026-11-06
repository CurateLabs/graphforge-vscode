# Result schema authority

GraphForge Core owns the canonical schemas and its live
`algorithmDescriptorContracts()` catalog. XYG owns their visualization
dispositions and exposes them through `graphforgeLedger()`.

The authoritative ledger is in the pinned XYG source:
[`graphforge-compositions.md`](../../vendor/xyg/spec/design/graphforge-compositions.md#3-recognition-and-the-coverage-ledger).
No schema-to-disposition mapping is authored in this repository.

`npm run qualify:xyg -- /absolute/path/to/@curatelabs/graphforge <evidence-directory>`
compares the installed Core's complete live catalog with the bundled XYG
runtime ledger. It fails on a newly unmapped algorithm, an ambiguous mapping,
or a changed result schema version. It also consumes XYG's hash-bound,
Core-produced Arrow corpus and compares native and WASM composition documents
for every permitted intent. The report distinguishes the live Core catalog
version from the fixture-producing Core version. Matching schemas do not
qualify all algorithm computations on another Core version.
The CI qualification lanes run this against their exact Core package.
