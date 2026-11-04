# XYG visualization integration

The extension uses one visualization engine and painter: XYG. Core owns queries,
algorithms and Arrow schemas. XYG owns intent validation, composition, UUID
joins, layout, geometry, styles, ticks, paint and PNG/SVG export. The extension
resolves project files, binds explicit fields, relays typed messages and owns
VS Code panels. There is no alternate renderer or layout fallback.

## Build and distribution

`vendor/xyg` is an exact Git submodule pin. Before installing a source checkout:

```sh
git submodule update --init vendor/xyg
npm ci
npm run compile
```

The source build requires XYG's pinned Rust toolchain.
`scripts/build-xyg.mjs` bundles the matching native library for the build
platform, the host-neutral painter, the Node facade and
its exact native FFI dependency into `dist/xyg`. `provenance.json` records the
source revision, platform and dirty status. Native loading retains XYG's platform and ABI
checks and never searches system libraries. A build is platform-specific;
package each supported platform separately. Source builds are used while XYG's
npm cohort remains unpublished. A local Mac build is not a public release or
proof of another platform.

## Durable data and authoring

A successful Core query keeps its original Arrow IPC in memory and persists it
beside both canonical and historical JSON/Markdown results as `.arrow`. The
JSON records its Arrow SHA-256. Reopen verifies that digest and decodes data
and numeric types from the original Arrow before rendering;
a missing or mismatched pair requires rerunning the query. Readable JSON is
for inspection, not a replacement for canonical Arrow types or metadata.

Saved `.gfviz.json` files contain XYG-owned `xyg.intent/v1` documents. The
contract and validator live in `@curatelabs/xyg-node/intent`, not in the editor.
Source references remain within the project. Old documents fail without being
rewritten. Create a new intent from the original query/result.

```json
{
  "format": "xyg.intent/v1",
  "name": "Routes",
  "kind": "result-graph",
  "result": "results/query-result.json",
  "filters": [],
  "graph": { "layout": "cose", "iterations": 250 }
}
```

A property graph query must return canonical entities, for example
`MATCH (a)-[r]->(b) RETURN a, r, b`. Algorithms remain original Arrow layers
with explicit `intent` and a canonical `base` result. Both generation identities
are required for joins; XYG rejects stale or incompatible inputs. The runtime
coverage ledger in XYG is the schema authority; the editor keeps no copy.

Charts bind `mark`, `x`, `y` and optional `color`/series fields. Maps bind
longitude/latitude and optional paired target fields, with explicit CRS,
projection and camera. Temporal views bind offset-qualified timestamps and
values in UTC. Graph filters belong in Cypher. No host invents coordinates,
timezones, reductions, aggregations or graph joins. Typed Core integers are
converted to chart f64 only when exactly representable; arbitrary numeric
strings and out-of-range integers fail clearly.

## Live lifecycle

`XygVisualizationPanel` owns one source result and `GraphForgeLayoutController`
per stable instance. Progressive CoSE frames come from XYG's native workers.
Only the data-less spec and typed paint buffer cross into the webview. Full
source positions, UUIDs and pick membership remain in the native host.

Messages carry instance identity, a monotonic render generation and paint-frame
identity. Superseded work is cancelled. The host accepts picks only for the
acknowledged paint frame and resolves them through XYG's membership contract.
Paint readiness requires a real webview acknowledgement. Closing a view
cancels work, rejects pending acknowledgements and disposes its resources.

Dynamic ticks use XYG's shared adapter and its explicit native host transport.
The editor relays bounded packed XYTK/XYTO bytes to `tickResolvePacked`; Rust
owns their generation and formatting. This avoids the webview's cross-origin
module-Worker restriction without a JavaScript tick algorithm or runtime host
fallback. This extension uses the native host explicitly and ships no unused WASM cohort.

The Result table is the accessible data companion. Selection is scoped to the
same source result. XYG supplies keyboard/gesture behavior and reduced-motion
controls; the editor provides labelled Fit, Re-layout and Save PNG + SVG
buttons. Export runs XYG's native static path and saves the pair under the
project's `visualizations/exports/` directory. XYG currently rejects static
time-axis export (`XYG_SCENE_UNSUPPORTED_PUBLIC_AXIS`); the timeline remains
interactive and that export failure is reported without changing its axis.

## Proof

- `npm run check` checks host, browser and benchmark types.
- `npm run test:unit` includes intent validation, typed binding, source-file
  confinement, Arrow preservation and real native XYG composition.
- `quickstart.e2e.test.ts` creates the actual 586-airport/7,430-route sample,
  persists Arrow and waits for real XYG paint of independent graph, chart, map
  and temporal panels in VS Code. The graph contains 579 connected airports;
  the other seven airports have no returned route. The temporal fixture is
  illustrative rather than historical air-traffic evidence.
- XYG's `host-ticks.test.mjs` checks byte identity with native Rust,
  cancellation, disposal and late-response rejection.
- `npm run verify:package` inventories packaged assets. A green source build
  does not establish the full platform, accessibility or large-scale release
  matrix; record those results explicitly before publication.

Local qualification (2026-11-03, macOS arm64): the installed VSIX opened the
air-routes project and received paint acknowledgements for all four views.
The notebook ran all code cells using GraphForge Python 0.5.2 and this XYG
source pin, producing CSV and HTML. This is distinct from the extension's
Core 0.6.0-rc.7 lane. Static time-axis export remains the known gap above.

Canonical entity inspection preserves UUIDs and native properties. Inspector
edits save parameterized mutation JSON with Core's typed UUID tag, then apply
that same query/parameter pair. The live test verifies an actual canonical
node edit before repainting the sample.

Inspector headings use meaningful property captions or entity identity; class
labels remain badges. Results keeps Inspect actions within a true table cell
and paints pinned cells over an opaque surface, including selected and hovered
rows, so horizontally scrolled values cannot show through the controls.
