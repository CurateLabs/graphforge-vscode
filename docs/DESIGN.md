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
| **First open** | Premium concierge — Kilo-like guided welcome; clear path in |
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

## Kilo-inspired workbench onboarding

First-run, missing-runtime, and no-project states share one **Get Started** sidebar webview (not raw error dumps):

- Branded header (GraphForge logo), short headline, one sentence of context
- Checklist cards with step status (pending / current / done) and primary CTAs
- Buttons dispatch existing palette commands (Setup Native, Setup Python, Open Project, Initialize, Run Query)
- **Check Environment** link for full JSON diagnostics — never inline stack traces in the panel or toasts
- Status bar click and setup recovery (`offerSetupRecovery`) open Get Started; capabilities doc only when a project is already open

Emulate Kilo Code’s **interaction patterns** (guided sidebar, cards, one primary CTA per step), not their brand colors — GraphForge keeps indigo accent (`#4c6ef5`) and the existing activity-bar icon.

## Welcome + experience modes (phase 2)

Kilo's "Choose how you want to work" step (REVIEW FIRST vs. HIGH AUTONOMY) maps
onto GraphForge's own vocabulary, not agent-autonomy language:

- **Guided** (default) — confirms before Initialize on an empty folder, leaves
  project auto-detection to the analyst, and keeps Result Graph closed until
  asked. This is the checklist experience that already existed.
- **Autonomous** — auto-opens the first detected project on activation, skips
  the Initialize confirmation for empty folders, and opens Result Graph after
  every query. Still fails closed on destructive operations (non-empty-folder
  init still confirms; the engine's write-mode/ontology-strictness guards are
  unaffected).

Persisted as `graphforge.experienceMode` (`guided` | `autonomous`, default
`guided`). The Get Started webview gains a **Welcome** screen — logo, one
sentence, two selectable mode cards, a single primary **Continue** — shown
before the existing runtime → project → query checklist the first time a
workspace opens the panel (detected via whether the setting has ever been
written, not a separate flag). "Change mode" in the checklist banner reopens
Welcome at any time; Continue re-applies the mode's settings. Status bar
clicks and `offerSetupRecovery` still land on this same panel (Kilo's
"Get Started / Next" promo-banner role is filled by the status bar + this
sidebar — GraphForge has no editor-level banner surface yet).

## Settings webview (phase 3, #24)

A **Settings** panel with left-nav categories (Kilo pattern #3) — `GraphForge:
Settings` (`graphforge.openSettings`), also linked from the Get Started footer.
It is a friendlier surface over the existing `graphforge.*` settings, not a
second store: reads/writes go through `workspace.getConfiguration`, and the
panel live-syncs with edits made in the VS Code Settings UI.

- Categories: **Runtime** (engine choice) / **Experience** (mode, Result Graph
  auto-open) / **Advanced** (manual binding/interpreter paths). Copy is
  analyst-facing; "Project" waits until a project-scoped setting exists (no
  stub categories).
- Accessibility is part of the contract, not a retrofit: the left nav is a
  keyboard-navigable `role="tablist"`, enums are native radio groups in
  fieldset/legend, and every control has a real label — the custom-div radio
  mistake flagged in the Get Started audit is off-limits here.
- Built as the first Vite `webview-ui/` surface (see
  `docs/engineering/ARCHITECTURE.md`, "Build tooling").

## Figure panel (analytical charts, #62)

Separate from Result Graph: a Vite-built **Figure** webview renders **Plotly figure JSON**
(`data` / `layout` / optional `frames`) for notebook-style charts (bar, scatter, histogram,
line). Agents call `graphforge.showFigure({ figure })` or
`graphforge.figureFromResult({ chartType, x, y, … })`. Optional size limits exist but
default **off**. Dash is not the IDE host — see ADR-0001 for CSP. Result Graph remains the
epistemic network surface (Cytoscape/Sigma later).

## Visual notes

- Activity Bar icon: simple node/edge mark (`media/graphforge.svg`).
- Result Graph v0: circular SVG layout; swap to Cytoscape/Sigma later without changing the host↔webview protocol.
- Figure panel: full bundled `plotly.js` in `webview-ui` (`figure.js` / `figure.css`).
- Prefer VS Code theme tokens in webviews; status colors are the intentional exception for belief state.

## Voice

Short, analyst-facing copy in one register (tool for GraphForge). Prefer “open project” / “run verb” / discovery language over infrastructure jargon. When the native binding is missing, say how to link it (README), not only that load failed. On success and failure, name a clear next option.
