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

Durable journey detail lives in [`experience/discovery-feeling.md`](./experience/discovery-feeling.md)
and [`experience/key-journeys.md`](./experience/key-journeys.md). Behavioral
persona hypotheses live in [`strategy/personas.md`](./strategy/personas.md).
Positioning note: [`strategy/positioning.md`](./strategy/positioning.md).

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
- The sample Query node exposes **Open Python notebook** and **Open Streamlit
  app** as parallel analyst paths. They read the same copied CSVs and use Python
  and XYG directly: the notebook writes portable CSV/HTML exports under
  `notebooks/outputs/`, while Streamlit serves an interactive browser dashboard.
  Neither path depends on or creates VS Code result-panel or visualization
  artifacts.
- The journey remains visible after completion. Its final node reopens the saved
  visualization rather than replacing the map with a feature dashboard.
- **Home / Query / Visualize** title actions remain available. Query authors save
  `.cypher` files and reopen durable result history; visualization settings are
  saved as `.gfviz.json` files referencing a project result. Layout, bindings, filters, chart encodings, geospatial camera,
  and UTC temporal bindings are project state, not hidden webview state.
- Buttons dispatch palette commands. Sample actions name project files under
  `queries/`, `notebooks/`, and `visualizations/`; query text, notebook analysis,
  and chart bindings never live in extension constants. Result Graph does not auto-open by default; users may opt
  into that independent preference in Settings.
- Semantic kinds share XYG's native engine and browser painter. Graphs consume
  original Core entity Arrow; charts, maps and timelines require explicit
  field bindings. No field inference or alternate renderer runs.
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
  auto-open) / **Advanced** (manual binding/interpreter paths). Copy is
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

## XYG visualizations

Graphs, charts, maps and timelines use XYG's native composition and shared
local browser painter. `.gfviz.json` contains `xyg.intent/v1` authoring intent
validated by XYG. The extension owns project paths, original Arrow persistence,
instance lifecycle and host transport. Invalid or obsolete documents fail
without rewriting files or substituting another renderer.

Graphs use XYG's progressive layout and canonical UUID picks. Charts bind a
mark and fields; maps bind explicit source/target coordinates and camera;
timelines bind offset-qualified timestamps in UTC. Fit, Re-layout and Save
PNG + SVG are labelled controls. Results provides the accessible data companion.
Edit and save the project intent to change durable settings; pan, zoom and
selection are transient. Playback and the retired adapters are unavailable.

The Python notebook and Streamlit sample use XYG's public composition API and
portable HTML output. Source installation is explicit while XYG is unpublished.
See [the XYG contract](engineering/XYG.md) for the supported surface and proof.

## Visual notes

- Activity Bar uses the GraphForge node/edge mark.
- Get Started is primary; Projects, Ontology and Knowledge start collapsed.
- Webviews use VS Code theme tokens, local assets and strict CSP.
- XYG owns graph geometry, chart axes, geographic projection and static export.

## Voice

Short, analyst-facing copy in one register (tool for GraphForge). Prefer “open project” / “run verb” / discovery language over infrastructure jargon. When the native binding is missing, say how to link it (README), not only that load failed. On success and failure, name a clear next option.
