# ADR-0003: AntV defaults with explicit visualization artifacts

- Status: Accepted
- Date: 2026-08-02
- Issue: [#67](https://github.com/CurateLabs/graphforge-vscode/issues/67)

## Context

GraphForge for VS Code needs higher-performance graph visualization plus first-class
analytical, geospatial, and temporal views. The visualization must remain a
project-owned presentation of GraphForge results, not a hosted analytics service
or a second graph engine. A user or coding agent must be able to inspect a saved
file and understand every material choice that produced the view.

The existing `graphforge.visualization/v1` contract supports Cytoscape/Sigma
result graphs and Plotly charts. Renderer defaults and some responsive behavior
also live in settings or runtime thresholds, which can make the same incomplete
spec behave differently across sessions.

## Decision

1. AntV is the default visualization family for newly created artifacts:
   - G6 with the Canvas backend for result graphs;
   - G2 for analytical and temporal charts;
   - L7 for geospatial views.
2. Cytoscape, Sigma, and Plotly remain supported alternatives. G6 WebGL is
   opt-in until GraphForge has its own Extension Development Host evidence.
3. The extension owns visualization adapters, interaction, accessibility, and artifact
   presentation. GraphForge Core continues to own graph storage, queries,
   algorithms, and result contracts. We will not build or fork a visualization
   engine for this work.
4. Studio reads existing `graphforge.visualization/v1` files without rewriting
   them and writes new work as `graphforge.visualization/v2`.
5. A v2 artifact explicitly records its semantic kind, result source, renderer,
   backend, bindings, transforms, filters, layout or coordinate system, and
   presentation configuration. Global settings are creation templates whose
   resolved values are materialized into the file; they do not reinterpret a
   saved artifact later.
6. One registry owns renderer capabilities and creation defaults. Changing the
   product default is a registry change, not a collection of UI conditionals.
7. There is no implicit field inference, aggregation, sampling, coordinate or
   timezone interpretation, graph-size threshold, renderer substitution, or
   layout fallback. Unsupported or incomplete configuration fails with a stable,
   actionable error while leaving the artifact unchanged.
8. Specs are JSON data, never executable configuration. Webviews bundle assets
   locally under the existing strict CSP: no CDN, remote data fetch, arbitrary
   callbacks, credentials in artifacts, `eval`, or broader implicit network
   access. The initial L7 adapter uses an explicit blank offline background.
9. Canvas/WebGL output is accompanied by keyboard-reachable controls, a textual
   summary, and an accessible data/entity surface. Reduced-motion preferences
   apply to layout animation, temporal playback, and transitions.
10. Visualization lifecycle diagnostics identify the kind, renderer, backend,
    phase, counts, durations, and stable error code. They never contain graph
    properties, result rows, geographic or temporal values, project paths, or
    complete specs, and they do not cause a silent fallback.
11. Performance evidence has two distinct layers. The repository's opt-in
    benchmark records deterministic adapter preparation over identical payloads.
    Actual renderer, layout, CSP, interaction, accessibility, and memory evidence
    comes from the documented Extension Development Host matrix. Neither is a
    routine CI or release gate.
12. The G6 creation template explicitly disables edge labels and arrowheads.
    These decorations remain editable artifact fields, but enabling both on the
    7,430-edge sample exceeds the current Canvas renderer's reliable paint path.
    There is no graph-size heuristic, sampling, or renderer fallback. G6 reports
    `renderReady` only after its Canvas has produced visible pixels; asynchronous
    Canvas failures and an empty painted surface are structured render failures.

## Consequences

- New visualization work is reproducible from project files and remains stable
  when product defaults change.
- Existing v1 projects keep their renderer and behavior without migration-on-open.
- G6/G2/L7 increase the browser bundle and packaging surface; the packaged VSIX
  and real Extension Development Host are required proof points.
- Worker and WebGL behavior cannot be established by Node-only benchmarks.
- Adding a new renderer requires a registry entry, adapter, strict schema support,
  accessible companion behavior, and evidence under the same lifecycle contract.
- Dense graphs retain every node and edge by default while avoiding per-edge
  label and marker decoration. Users can opt into those costs by changing and
  saving the explicit style fields in their artifact.
- ADR-0001 still governs the retained raw Plotly path and its CSP. This record
  changes the default for new analytical artifacts without weakening that CSP.
