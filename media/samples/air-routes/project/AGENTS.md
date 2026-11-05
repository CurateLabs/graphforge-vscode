# Air-routes project contract

This is a `graphforge-project/v1` project. Preserve the FORMAT marker and keep
work inside the project. Queries live under `queries/`; reviewed writes under
`mutations/` require explicit confirmation. Results contain readable JSON and
Markdown alongside original Core `.arrow` data. Preserve each matching pair.

Visualizations are XYG-owned `xyg.intent/v1` `.gfviz.json` documents with an
explicit result path and graph/chart/geospatial/temporal bindings. Graphs require
canonical entity Arrow. Do not infer fields, fabricate graph entities, rewrite
obsolete vendor documents or introduce a renderer fallback. Change and save
intent files for durable edits; pan/zoom/selection are transient.

Use `graphforge.agent.getContext`, then `graphforge.runProjectQuery({ path })`,
`graphforge.openProjectResult({ path })` and
`graphforge.openProjectVisualization({ path, waitForReady: true })`.
`graphforge.createProjectVisualization` saves before opening.
`graphforge.exportVisualization` exports the active view as PNG and SVG under
`visualizations/exports/`. Paths must resolve inside the project.

Start with `queries/templates/routes-overview.cypher`. Four saved XYG views
are under `visualizations/`. The timeline is illustrative, not historical
traffic. The Python notebook and Streamlit app use the copied CSVs directly;
see `apps/README.md` for explicit source installation while XYG is unpublished.
