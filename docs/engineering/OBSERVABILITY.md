# Observability

GraphForge for VS Code ships no product telemetry. Its current signals are local:

- **Status bar** — project name + ontology mode, or “binding missing”.
- **Error toasts** — open/query/verb/load-ontology failures.
- **Visualization panel status** — render and layout progress or an actionable
  failure, without changing the saved artifact.

## Visualization lifecycle (#67)

XYG status distinguishes preparing, progressive layout, paint and ready/error.
The browser sends `client-loaded`, `view-created`, `ticks-ready` and `painted`
diagnostics. Commands optionally await `graphforge/renderReady` after a real
paint acknowledgement, or `graphforge/renderFailed` with a stable code. Both
bootstrap and frame acknowledgement waits are bounded. See [XYG](XYG.md).

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
