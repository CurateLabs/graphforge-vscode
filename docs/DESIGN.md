# Design

## Product experience

GraphForge in VS Code should feel like a **workbench**, not a database admin console.

- **Cypher stays visible** — language mode, editor title Run Query, not only a hidden command.
- **Analyst verbs are peers** — Rank/Cluster/Paths/Analyze/Similar/Find in the command palette at the same level as Run Query.
- **Ontology is progressive** — exploratory empty state is valid; advisory/strict show types without shaming exploration.
- **Epistemic status is legible** — result graph legend always names statuses; colors are extension-owned until product branding defines a palette.

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

## Visual notes

- Activity Bar icon: simple node/edge mark (`media/graphforge.svg`).
- Result Graph v0: circular SVG layout; swap to Cytoscape/Sigma later without changing the host↔webview protocol.
- Prefer VS Code theme tokens in webviews; status colors are the intentional exception for belief state.

## Voice

Short, analyst-facing copy. Prefer “open project” / “run verb” over infrastructure jargon. When the native binding is missing, say how to link it (README), not only that load failed.
