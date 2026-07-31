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

## Visual notes

- Activity Bar icon: simple node/edge mark (`media/graphforge.svg`).
- Result Graph v0: circular SVG layout; swap to Cytoscape/Sigma later without changing the host↔webview protocol.
- Prefer VS Code theme tokens in webviews; status colors are the intentional exception for belief state.

## Voice

Short, analyst-facing copy. Prefer “open project” / “run verb” over infrastructure jargon. When the native binding is missing, say how to link it (README), not only that load failed.
