# XYG visualization integration

The extension uses one visualization engine and painter: XYG. Core owns queries,
algorithms and Arrow schemas. XYG owns intent validation, composition, UUID
joins, layout, geometry, styles, ticks, paint and PNG/SVG/HTML export. The extension
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
its exact native FFI dependency into `dist/xyg`. The matching browser WASM
module, worker and version/hash manifest ship with the painter. `provenance.json` records the
source revision, platform and dirty status. Native loading retains XYG's platform and ABI
checks and never searches system libraries. A build is platform-specific;
package each supported platform separately. Source builds are used while XYG's
npm cohort remains unpublished. A local Mac build is not a public release or
proof of another platform.

`scripts/build-core.mjs` also bundles the lockfile-pinned Core facade and exactly
one native platform package under `dist/core`, including their licenses and
notices. The installed extension resolves this bundled Core by default; an
explicit `graphforge.nativeModulePath` remains an override. Core provenance
records the exact registry integrities, platform, native size and SHA-256.
The complete native engine changes the package budget from the former
XYG-only 15 MiB to 256 MiB unpacked and 240 files. Every platform lane checks
the actual package rather than assuming the Mac size applies elsewhere.

## Durable data and authoring

A successful Core query keeps its original Arrow IPC in memory and persists it
beside both canonical and historical JSON/Markdown results as `.arrow`. The
JSON records its Arrow SHA-256. Reopen verifies that digest and decodes data
and numeric types from the original Arrow before rendering;
a missing or mismatched pair requires rerunning the query. Readable JSON is
for inspection, not a replacement for canonical Arrow types or metadata.

Reopening an existing air-routes sample upgrades only the exact unchanged
pre-XYG default query to return canonical entities, preserving its original
bytes as `routes-overview.cypher.pre-xyg`. Customized queries and saved results
are preserved. Run the sample query again to produce its original Core Arrow;
old JSON-only results cannot supply canonical graph types.

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
The [coverage guard](RESULT_SCHEMAS.md) compares the live Core catalog with that
runtime ledger. Analytical source IDs are opaque hashes of the result reference,
generation and original Arrow. Native pick membership relays exact source rows,
including derived relationships and aggregate members without persisted UUIDs.
Table selection uses XYG's membership; derived relationships highlight their
native endpoint UUIDs without inventing relationship IDs.

Explicit `bar-chart` and `parallel-coordinates` compositions use XYG's chart
builder without an invented base graph. Table-only compositions report
`XYG_TABLE_ONLY` and direct the analyst to Results; they are never passed into
a graph-layout worker or saved as an unusable visualization.

Plain graphs also retain the source generation UUID. XYG chooses captions from
the first non-empty text `name`, `title`, `label`, or `code`, then a short UUID;
code-only Airport entities therefore display their airport code without host
caption rules. Typed zero-row entity results are valid empty graphs. UUIDs,
self-loops and parallel relationships remain native XYG identities.

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

Dynamic ticks use XYG's shared adapter and its bundled Rust/WASM worker directly
in the webview. The self-contained local worker starts from a Blob to respect
VS Code's cross-origin resource rules. Its matching module validates the ABI,
Scene and palette contract before attachment. Each panel borrows one worker
across its frames and disposes it on unload; superseded views retire their own
tick handles. Graph composition/layout and static exports use the native host.
There is no JavaScript tick algorithm, native tick-message relay, or host fallback.

The Result table is the accessible data companion. Selection is scoped to the
same source result. XYG supplies keyboard/gesture behavior and reduced-motion
controls; the editor provides labelled Fit, Re-layout and Save PNG + SVG
buttons. Export runs XYG's native static path and saves the pair under the
project's `visualizations/exports/` directory. XYG currently rejects static
time-axis export (`XYG_SCENE_UNSUPPORTED_PUBLIC_AXIS`); the timeline remains
interactive and that export failure is reported without changing its axis.

The workbench keeps Results pages bounded to 500 rows, including selection of
later rows. Previous/Next retain original row numbers; row arrow keys and native
Inspect/expand activation remain available. Selected text uses selection
foreground tokens. Inspector editing preserves focus and drafts on failure.

Result metadata distinguishes original Arrow from table-only JSON and retains
an optional project query path for navigation. Recovery opens that file for an
explicit rerun; result metadata never executes a query. All visualization kinds
validate their source fields, filters and native XYG composition before saving
or replacing an artifact. Graphs reject host row filters before they can discard
the graph's Arrow. Temporal granularity is not offered. The UI disables time-axis
image export while that pinned XYG capability is unavailable.

Theme changes regenerate visible native scenes, including both VS Code
high-contrast variants. Retained hidden views defer theme, motion and viewport
recomposition until reveal so they do not compete with the active view. Browser
chrome uses host tokens and the matching native-control color scheme. Reduced motion paints the completed native graph layout rather
than its intermediate frames, disables animated Fit, and reveals linked result
rows without smooth scrolling. Pending readiness follows the current render
generation through theme and motion updates. The browser reports bounded
container dimensions so split-editor resizes recompose the native scene.
Reopening an unchanged saved graph retains its completed paint or pending render
when its intent, exact Arrow bytes and generation identities still match. This
avoids restarting a theme render solely to wait for readiness. Re-layout remains
an explicit operation, and changed sources or failed views render again. Reduced-motion rendering batches native force steps to avoid packing unused
intermediate scenes. Final positions and cancellation stay native-owned. The
engine retains its default 30-second layout bound and the panel retains its
60-second readiness deadline.

Result saves prepare JSON, Markdown and Arrow in a private staging directory,
then publish their files without yielding to other reads or writers in the same
extension host. The digest still rejects mismatches caused by interrupted
publication or external processes; this is not a filesystem-wide transaction.

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
- `node scripts/qualify-plain-cypher.mjs /path/to/@curatelabs/graphforge`
  creates a fresh temporary Core project. It checks code-only captions,
  nodes-only and node/relationship results, loops, parallel edges, empty
  results, native layout, repeated export bytes and UUID/generation preservation
  on reopen. Its report contains counts and hashes, without source rows.
- `npm run verify:package` inventories packaged assets. A green source build
  does not establish the full platform, accessibility or large-scale release
  matrix; record those results explicitly before publication.
- `npm run qualify:xyg -- <Core package directory> <evidence directory>` requires
  every live Core algorithm to match XYG's ledger and its engine-produced corpus,
  then compares native/WASM request framing, composition bytes, identity and
  bounded Scene output for supported fixtures. Reports name the live catalog
  and fixture-producing Core versions separately.
- `npm run qualify:xyg:installed -- <platform VSIX> <evidence directory>` installs
  the package into an isolated profile, uses its bundled Core with no path
  override, qualifies the installed native/WASM artifacts, and exercises real
  analytical charts plus the full quickstart matrix, durable reopen and split
  resize. Qualification cannot skip its tests.
- `.github/workflows/xyg-qualification.yml` runs the installed lane on Linux
  x64/arm64, macOS x64/arm64, and Windows x64. Each lane builds its own VSIX,
  checks the actual host architecture, and retains its exact package and reports.
  Remote hosts and full release acceptance remain separate evidence; see
  [the qualification matrix](XYG_QUALIFICATION.md).

Local qualification (2026-11-03, macOS arm64): the installed VSIX opened the
air-routes project and received paint acknowledgements for all four views.
The initial notebook proof ran all code cells using GraphForge Python 0.5.2
and XYG `14e944b`, producing CSV and HTML. The source-install examples now
track the updated extension pin; plain-Cypher Python fixture qualification
is recorded in the [plain-Cypher qualification](evidence/plain-cypher-qualification.md). This is distinct from the extension's
Core 0.6.0-rc.7 lane. Static time-axis export remains the known gap above.

Canonical entity inspection preserves UUIDs and native properties. Inspector
edits save parameterized mutation JSON with Core's typed UUID tag, then apply
that same query/parameter pair. The live test verifies an actual canonical
node edit before repainting the sample.

Inspector headings use meaningful property captions or entity identity; class
labels remain badges. Results keeps Inspect actions within a true table cell
and paints pinned cells over an opaque surface, including selected and hovered
rows, so horizontally scrolled values cannot show through the controls.

Graph, chart and timeline panels also provide Save HTML. The extension passes
the exact acknowledged spec and bytes to XYG’s `toHtml()`; its standalone
client, classic tick worker and WASM are colocated in `dist/xyg/node/client`.
The artifact renders offline through XYG’s shared Rust tick lane. Maps retain
PNG/SVG export until their painter payload has a standalone document contract.
HTML exports contain the painted data and capture the chart snapshot; temporal
playback and cursor/range/window export semantics remain unqualified.
