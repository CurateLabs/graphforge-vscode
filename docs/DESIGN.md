# Design

## Emotional north star

**Primary feeling:** exploring and uncovering hunches — a guided discovery workbench for GraphForge, not a graph admin console.

**Anti-goals:** never feel **complex** or **brittle**.

**Register:** one voice everywhere. This is a **tool for GraphForge** — concierge guidance serves discovery; it is not a separate brand theater vs product tone.

| Need state | Emotional job |
|---|---|
| **Before** | Need a different way of looking at data; open to new perspectives |
| **During** | Curious and supported in discovery |
| **After** | Empowered and ready for the next question |

| Moment | Beat |
|---|---|
| **First open** | One visible path from environment to a saved, inspectable graph view |
| **Success** | Clear next options (never a dead end) |
| **Failure** | Easy recovery; clear what failed |
| **Wait** | Honest progress — what is happening, and whether it may be stuck |
| **Return** | Easy path to new work *or* resume prior work (Cursor-style open) |

**Trust:** clear results and clear failures. **Anxiety spike:** hung analysis with no signal whether the engine is crunching or dead.

Durable journey detail lives in [`experience/discovery-feeling.md`](./experience/discovery-feeling.md). Positioning note: [`strategy/positioning.md`](./strategy/positioning.md).

## Product experience

GraphForge in VS Code should feel like a **workbench for uncovering hunches**, not a database admin console.

- **Cypher stays visible** — language mode, editor title Run Query, not only a hidden command.
- **Analyst verbs are peers** — Rank/Cluster/Paths/Analyze/Similar/Find in the command palette at the same level as Run Query.
- **Ontology is progressive** — exploratory empty state is valid; advisory/strict show types without shaming exploration.
- **Epistemic status is legible** — result graph legend always names statuses; colors are extension-owned until product branding defines a palette.
- **Concierge, not complexity** — first-run and recovery feel guided and calm; surfaces stay simple and fail closed rather than brittle.

## Coding-agent surface

IDE agents use the same workbench through commands and project files, without
scraping Get Started or visualization webviews. `graphforge.agent.getContext`
is the versioned discovery entry point: it returns runtime/project state,
effective settings, exact `FORMAT` marker status, absolute artifact paths, and
canonical/latest result paths. Query, result, visualization, and mutation
commands accept paths/URIs directly. Mutations remain visibly separate under
`mutations/` and require explicit `{ confirm: true }` for non-interactive use.
Visualization creation requires explicit kind and field bindings and returns the
saved `{ path, spec, panel? }`; agents do not need to infer state from a canvas.
The quickstart project carries an `AGENTS.md` copy of this local contract.

## Path-first workbench onboarding

First-run, missing-runtime, and no-project states share one **Get Started** sidebar webview (not raw error dumps):

- Branded header (GraphForge logo), short headline, one sentence of context
- One persistent journey tree: **Environment → Project → Query → Result → Visualize**
- Exactly one current node, one primary next action, and quiet pending nodes so the
  user sees both their current location and the entire shortest path to value.
- Progress comes from visible evidence: an active runtime, the project `FORMAT`
  marker, a project-owned query, saved result JSON, and saved visualization JSON.
  The map never advances from an opaque onboarding-complete flag.
- **Try the air-routes sample** is the secondary Project action. It follows the
  same path and materializes its data, query, notebook, supporting result, and
  visualization files inside the sample project.
- The sample Query node exposes **Open Python notebook** as a parallel analyst
  path. The notebook reads the same copied CSVs and writes standard `results/`
  and `visualizations/` artifacts; the extension does not hide or synthesize its
  Python work.
- The journey remains visible after completion. Its final node reopens the saved
  visualization rather than replacing the map with a feature dashboard.
- **Hub / Query / Visualize** title actions remain available. Query authors save
  `.cypher` files and reopen durable result history; visualization settings are
  saved as `.gfviz.json` files referencing a project result. Renderer/backend,
  layout, bindings, filters, chart encodings, geospatial coordinates/projection,
  and temporal range/playback are project state, not hidden webview state.
- Buttons dispatch palette commands. Sample actions name project files under
  `queries/`, `notebooks/`, and `visualizations/`; query text, notebook analysis,
  and chart bindings never live in extension constants. Result Graph does not auto-open by default; users may opt
  into that independent preference in Settings.
- Semantic kinds remain distinct even though their adapters share one artifact
  policy: Result Graph consumes `GraphPayload`; charts and timelines consume
  tabular results; maps consume explicit coordinate or GeoJSON fields. Raw
  Plotly Figure JSON remains a separate preview/interchange path.
- **Check details** at the Environment node opens full JSON diagnostics — never inline stack traces in the panel or toasts
- Status bar click and setup recovery (`offerSetupRecovery`) open Get Started; capabilities doc only when a project is already open

GraphForge uses VS Code's interaction language and its own indigo accent
(`#4c6ef5`). There is no startup persona or experience-mode choice. Opening a
project, initializing an empty folder, running a query, and creating a view are
explicit actions; destructive replacement of a non-empty target still confirms.

## Settings webview (phase 3, #24)

A **Settings** panel with left-nav categories (Kilo pattern #3) — `GraphForge:
Settings` (`graphforge.openSettings`), also linked from the Get Started footer.
It is a friendlier surface over the existing `graphforge.*` settings, not a
second store: reads/writes go through `workspace.getConfiguration`, and the
panel live-syncs with edits made in the VS Code Settings UI.

- Categories: **Runtime** (engine choice) / **Visualizations** (Result Graph
  auto-open, G6/Cytoscape/Sigma and G2/Plotly creation templates) / **Advanced** (manual binding/interpreter paths). Copy is
  analyst-facing; "Project" waits until a project-scoped setting exists (no
  stub categories).
- Accessibility is part of the contract, not a retrofit: the left nav is a
  keyboard-navigable `role="tablist"`, enums are native radio groups in
  fieldset/legend, and every control has a real label — the custom-div radio
  mistake flagged in the Get Started audit is off-limits here.
- Built as the first Vite `webview-ui/` surface (see
  `docs/engineering/ARCHITECTURE.md`, "Build tooling").

## Module Bay

`GraphForge: Manage Modules` opens the Vite-built **Module Bay**, the single place
to understand and control workbench capabilities. Query, Visualize, Import, and
future Connect modules use the same card and lifecycle whether they ship in this
repository, come from GraphForge's catalog, or were side-loaded from a manifest.

- The header reports the active-module count; filters narrow the bay to All,
  Query, Visualize, Import, or Connect (`integration`) without changing installed
  state.
- Every card names the module, source, version, capability, and current status.
  A route-colored edge distinguishes Query (blue), Visualize (purple), Import
  (teal), and Connect/integration (amber) while leaving VS Code theme tokens in control of
  the surrounding surface.
- Installed modules have a native enable switch. Available modules have Install;
  removable catalog or side-loaded modules have Remove. A module may also expose
  a clear primary action such as Run Query, Visualize, or Import Data.
- Query, Visualize, and Import are visibly identified as default modules. They
  are installed with the extension, may be disabled, and cannot be removed through
  the module lifecycle. Catalog and side-loaded modules follow the same presentation rather than
  forming a second marketplace-shaped UI.
- The extension host remains authoritative for state and sends complete module
  snapshots to the webview after every action. The webview never infers that an
  install, toggle, or removal succeeded.
- Side-loaded modules are visibly identified and remain declarative by default.
  An Advanced user-level setting may allow a reviewed, contained CommonJS file,
  but only in a trusted workspace and after a per-install modal warning. The
  workspace cannot enable that permission for itself. The footer explains that
  boundary at the point of use.
- Keyboard focus, native checkbox semantics, responsive layout, reduced-motion
  behavior, and light/dark/high-contrast VS Code themes are part of the surface's
  contract.

The manifest and provider contracts live in
[`engineering/MODULES.md`](./engineering/MODULES.md).

## Figure and analytical charts (#62 / #67)

New saved analytical chart artifacts use Plotly by default; G2 remains an
explicit chart option and the temporal adapter. Their complete
encodings, transforms, filters, axes, theme, timezone, range, and playback
configuration live in v2 JSON. The Vite-built **Figure** webview remains for raw
Plotly JSON, v1 Plotly artifacts, and v2 Plotly charts. Agents may
still call `showFigure({ figure })` or `figureFromResult(...)`; this preview does
not replace the project artifact contract. Optional Plotly limits default off.
Dash is not the IDE host—see ADR-0001.

## Result Graph workbench (#65)

Result Graph is a Vite-built interactive network canvas over the existing
`GraphPayload` contract. New artifacts default to **Cytoscape Canvas** with an
explicit CoSE configuration; AntV G6 Canvas and Sigma WebGL remain selectable
adapters. All preserve epistemic/class colors, legends, empty states,
pan, zoom, fit, re-layout, and click-to-inspect. The renderer setting chooses the
next artifact template only. Saved configuration wins on reopen, and failures
remain visible rather than changing renderer/layout or applying graph-size magic.
The optional G6 creation template keeps all graph elements but explicitly starts with
edge labels and arrowheads disabled; those optional per-edge decorations remain
editable and saved in the artifact. Readiness requires visible Canvas output, so
an invisible scene graph with working hit targets is reported as a render failure.

## Geospatial and temporal artifacts (#67)

L7 renders geospatial artifacts from explicit point coordinates, source/target
link coordinates, or GeoJSON bindings, CRS, projection, ordered point/arc/line/polygon
layers, explicit blank offline basemap, and viewport. Link maps materialize unique
endpoint nodes and draw their saved arc layers without guessing field names. G2 renders
temporal artifacts from explicit timestamp, timezone, granularity, value/series,
range, window, and playback settings. Neither surface guesses fields or reaches
for a remote provider. Both include a textual summary and accessible filtered
data table. Material viewport/range changes produce visible dirty state; Save
commits validated JSON and Revert restores the last committed artifact.

## Visual notes

- Activity Bar icon: simple node/edge mark (`media/graphforge.svg`).
- Get Started is the primary surface when the GraphForge container first opens; Projects, Ontology, and Knowledge are present but initially collapsed.
- Result Graph: bundled G6/Cytoscape/Sigma adapters under strict CSP and the stable `GraphPayload` protocol.
- Artifact visualization panel: bundled G2/L7 chart, map, and timeline adapters with Save/Revert and accessible rows.
- Figure panel: retained full bundled `plotly.js` (`figure.js` / `figure.css`).
- Prefer VS Code theme tokens in webviews; status colors are the intentional exception for belief state.

## Voice

Short, analyst-facing copy in one register (tool for GraphForge). Prefer “open project” / “run verb” / discovery language over infrastructure jargon. When the native binding is missing, say how to link it (README), not only that load failed. On success and failure, name a clear next option.
