# ADR-0004: Restore Cytoscape and Plotly creation defaults

- Status: Accepted
- Date: 2026-08-02
- Supersedes: ADR-0003 default selections only

## Context

ADR-0003 made AntV G6 and G2 the graph and analytical-chart creation defaults
while preserving Cytoscape, Sigma, and Plotly as explicit adapters. Extension
Development Host use showed that the AntV paths remain less reliable than the
previous Cytoscape and Plotly experience. Renderer lifecycle diagnostics now
make those failures visible, but visibility does not make a buggy adapter the
right first-run choice.

The artifact-owned v2 contract remains sound: saved work records its renderer
and complete configuration, and opening a saved artifact must never reinterpret
it using a newer global default.

## Decision

1. New Result Graph artifacts default to Cytoscape Canvas with an explicit CoSE
   configuration.
2. New analytical chart artifacts default to Plotly.
3. AntV G6 and G2 remain first-class explicit choices. Sigma remains an explicit
   graph choice. Existing saved G6/G2 artifacts continue to open unchanged.
4. Temporal artifacts remain G2 and geospatial artifacts remain L7 because those
   visualization kinds do not yet have retained non-AntV adapters.
5. The quickstart journey prefers its saved Cytoscape Result Graph. The E2E path
   exercises that same saved artifact and waits for the renderer's terminal
   lifecycle state. Explicit G6/G2 creation and validation stay covered by unit
   tests and the renderer matrix.
6. Changing these defaults is limited to the registry, configuration defaults,
   direct-view fallback, documentation, and tests. It does not migrate or rewrite
   project artifacts.
7. Opening a graph applies renderer, options, and payload as one render snapshot.
   Separate protocol messages remain compatible, but do not trigger duplicate
   force-layout work while a saved artifact is being restored.

## Consequences

- First-run graph and analytical-chart behavior returns to the more stable
  Cytoscape and Plotly paths.
- Users can switch back to G6 or G2 from Settings or by recording the renderer
  explicitly in a new artifact.
- Existing AntV work remains reproducible because saved artifacts stay
  authoritative.
- AntV renderer defects remain actionable implementation work rather than costs
  imposed on every new visualization.
- ADR-0003 still governs the explicit artifact contract, strict CSP, lifecycle
  diagnostics, accessibility, and the rule against silent renderer fallback.
