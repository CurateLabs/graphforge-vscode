# ADR-0005: Adopt the GraphForge component boundaries in the extension

- Status: Accepted
- Date: 2026-10-03
- Shared decision: [GraphForge ADR 0054](../PRODUCT_BOUNDARIES.md) (generated public copy;
  do not edit it here)

## Context

GraphForge ADR 0054 assigns one owner to every contract between GraphForge Core, XYG, this
extension, and the Hub (graphforge.sh). [`PRODUCT_BOUNDARIES.md`](../PRODUCT_BOUNDARIES.md)
holds that decision verbatim, and it is identical in every GraphForge repository. This ADR
records only what the shared decision means for this extension.

Before the shared decision, the extension had drifted in several ways:

- It owned a visualization spec (`graphforge.visualization/v2`) full of vendor renderer
  fields that no other host could read.
- It authored the result-schema ledger (`RESULT_SCHEMAS.md`) that XYG interprets.
- It had no path to or from the Hub.
- It used "Hub" as the name of a Get Started page.

## Decision

1. **Orchestrate, never re-implement.** The extension captures analyst and agent intent and
   calls Core and XYG. It has no engine, visualization, or Hub-protocol logic of its own.
2. **Reach the Hub only through Core.**
   - `graphforge.cloneFromHub` and the
     `vscode://curatelabsai.graphforge/clone?repository=<owner>/<repo>[&ref=…][&version=…]`
     link run Core's `gf clone` in-process. A clicked link always confirms first.
   - Publishing will invoke Core's `gf publish`, with native data plus explicitly selected
     PNG/SVG previews. Nothing is published by default, and Core owns the credential.
3. **Saved visualizations are XYG intent documents.** They stay in the Project folder and
   reopen in the editor. The published form is the PNG and SVG pair from XYG's static export.
   The extension writes no visualization format of its own and persists no scenes. This
   replaces the v2 writer in #82's pre-v1 clean break.
4. **No compatibility handshake in the extension.** XYG checks Core's result-schema stamps
   while composing. The extension shows XYG's stable error and its next action.
5. **Exact pins, a matching engine when needed.** Each release pins exact Core and XYG
   versions and bundles their native code per platform (#82). Before v1, data runs only on
   the Core version that wrote it. To open a Project from another version, the analyst
   selects that version through `graphforge.engineVersion` or a matching Python
   environment (the Python runtime stays for this reason). Clone and open errors name the
   required version.
6. **Desktop only.** The extension supports local and remote extension hosts, but not
   browser-only editors, because Core is native-only.
7. **"Hub" means graphforge.sh.** The Get Started page is "Home"
   (`graphforge.getStarted.showHome`), and `showHub` stays as an alias.

## Consequences

- The extension shrinks to orchestration and experience: no renderer adapters, no
  visualization schema, no ledger, no protocol code.
- Each Core or XYG bump is a coordinated extension release.
- Opening an older published Project can require a matching engine version until Core ships
  data fix-up.
- The legacy renderers stay until XYG supports plain Cypher graphs (CurateLabs/xyg#934) and
  publishes a release, so the most common journey never regresses.

## Tracking

| Step | Issue |
|---|---|
| Rename Hub page to Home | #87 |
| Clone from the Hub | #88 |
| Compatibility check in XYG (replaces the extension handshake #89) | CurateLabs/xyg#936 |
| Plain-graph composition with best-practice defaults | CurateLabs/xyg#934, then #80 |
| Ledger authority to XYG | #90, CurateLabs/xyg#936 |
| Intent document and PNG/SVG export pair; renderer removal | CurateLabs/xyg#935, #82 |
| Per-platform packages with bundled natives | #82 |
| Native-only packages and the preview channel | CurateLabs/graphforge#1768 |
| Producing-version declaration and future data fix-up | CurateLabs/graphforge#1769 |
| Publish native data plus selected previews | #91 |
