# Observability

GraphForge for VS Code ships no product telemetry. Its current signals are local:

- **Status bar** — project name + ontology mode, or “binding missing”.
- **Error toasts** — open/query/verb/load-ontology failures.
- **Visualization panel status** — render and layout progress or an actionable
  failure, without changing the saved artifact.

## Visualization lifecycle (#67)

Visualization adapters report the same phases to the extension host:

- `renderStarted`
- `layoutStarted` when layout applies
- `layoutReady` when layout completes
- `renderReady` when the view can be used
- `renderFailed` with a stable error code and next action

The same lifecycle is visible inside the panel. A full-canvas render-pipeline
surface covers provisional output until it is usable and names renderer-specific
work: G6/Sigma ForceAtlas2, Cytoscape CoSE, G2 mark composition, L7 scene/layer
construction, or Plotly trace composition. It shows data, layout/composition,
and paint as discrete states because the adapters do not expose trustworthy
percentage completion. Screen readers receive the same status through a polite
live region; a stable summary remains after readiness.

A diagnostic may include only:

- visualization format and semantic kind;
- renderer, drawing backend, layout type, and execution mode;
- node, edge, row, or layer counts;
- phase duration;
- a stable error code and non-sensitive summary.

Never include graph labels or properties, result rows, coordinates, timestamps,
project or artifact paths, credentials, or the serialized visualization spec.
Lifecycle events are local diagnostics, not usage analytics. A failure must keep
the requested renderer and artifact intact; it must not trigger an unreported
renderer, backend, layout, data, or configuration fallback.

Any future telemetry remains opt-in and must preserve the same data-minimization
boundary. Graph contents and project paths are never sent by default.
