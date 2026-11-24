# Changelog

All notable changes to the GraphForge VS Code extension are documented here.

## 0.2.0

Paired with GraphForge Core 0.6.0. Platform-specific VSIX packages bundle `@curatelabs/graphforge` 0.6.0 and the XYG renderer.

### Breaking

- XYG is now the only result renderer. Cytoscape, Sigma, Plotly and the AntV G6/G2/L7 renderers are removed, and the `graphforge.resultGraph.renderer`, `graphforge.chart.renderer`, `graphforge.figureLimitsEnabled`, `graphforge.figureMaxBytes`, `graphforge.figureMaxPoints` and `graphforge.figureMaxTraces` settings are no longer read.
- The extension declares the Core versions it is qualified against (`graphforge.qualifiedCore`: `>=0.6.0 <0.7.0`, refusing below `0.5.1`). A loadable Core outside the range warns with `CORE_VERSION_UNQUALIFIED`; one below the floor refuses with `CORE_VERSION_UNSUPPORTED`. Both name the fix, and `Check Environment` reports the verdict under `core`.

### Added

- **Clone from Hub**: `GraphForge: Clone from Hub` and `vscode://curatelabsai.graphforge/clone` links open a GraphForge Hub repository through Core's `gf clone`, then open the project. Links confirm before any disk or network work. The extension never calls a Hub API itself, and Core's `hub.*` codes pass through.
- **Publish to Hub**: `GraphForge: Publish to Hub` runs Core's `gf publish` for a Branch or Version after a confirmation that names the repository, project and producing Core version. Native data only: previews are not published yet. Agent calls need `confirm: true`. Core's `hub.publish.*` codes and credential guidance pass through. The extension stores no credential.
- **Export Visualization**: `GraphForge: Export Visualization as PNG + SVG` saves the active XYG view as PNG/SVG. Passing `{ format: "html" }`, or **Save HTML** in the view, saves a painted graph, chart or timeline as self-contained HTML that opens offline.
- XYG graph, chart, timeline and map views over Arrow results, with bundled native and WASM artifacts per platform.
- Platform-specific VSIX packages bundle the exact Core binding from `package.json`, with its registry integrity recorded in `dist/core/provenance.json`.

### Changed

- The Get Started page is now **Home** (`graphforge.getStarted.showHome`). `graphforge.getStarted.showHub` remains a working alias.
- Query results stay Arrow-backed. Tables and agent commands read bounded pages instead of materializing every row, and each exposed result is bound to the session that produced it.
- Setup's engine version picker recommends the newest qualified Core instead of leading with the registry's `latest` tag. Versions are labelled qualified / not qualified, refused versions are hidden, and the offline fallback comes from the qualified range.
- Each saved visualization has its own lifecycle and can be reopened independently.
- Component boundaries follow GraphForge ADR 0054: the extension orchestrates Core and XYG and does not re-implement engine, Hub or visualization behavior.

### Fixed

- Hub clone keeps Core's filesystem-admission diagnostics (`GF_UNSUPPORTED_FILESYSTEM`) and replaces generic network advice with storage guidance for the host platform, including Dev Containers and WSL.
- Agent calls to clone a Hub repository with a destination validate without prompting.
- Hub publishing now explains Core's `hub.publish.id_taken` refusal with its privacy-filtered ID and owner guidance. Authorized organization recovery comes first; ID regeneration requires a modal confirmation, runs only Core's rewrite command, and offers publication of the same Branch. Exact-Version recovery refuses because the current Core command cannot target that selection.
- Hub clones retain Core's structured warnings on success and failure. A `GF_CORE_VERSION_MISMATCH` warning reaches agents in the command result and users in a warning notification, with the producing/running versions and matching-runtime guidance; a warning alone does not turn a completed clone into a failure.

### Known limitations

- Maps export PNG/SVG only; there is no offline HTML export for maps.
- Static PNG/SVG export of a time axis is refused with `XYG_SCENE_UNSUPPORTED_PUBLIC_AXIS`. HTML export captures the painted chart without playback or cursor/range/window state.
- Publish to Hub sends native data only. Requests with previews are refused with `HUB_PUBLISH_PREVIEWS_UNAVAILABLE`.
- The Result table is the accessible companion to each view. The XYG views have not been certified with screen readers.
- Remote extension hosts (Dev Containers, WSL, SSH, tunnels) use the remote host's storage rules. Only Dev Container cloning has been qualified on a real remote host; WSL, SSH and tunnels are covered by unit tests.

## 0.1.3

### Added

- Portable air-routes Streamlit dashboard under `apps/`, with **Open Sample Streamlit App**.
- Proto-personas and key human journey docs for analysis experience design.

### Changed

- Quickstart sample materializes under `~/Downloads/graphforge-quickstart` instead of workspace or extension-private storage.
- Sample notebook focuses on portable CSV/HTML outputs rather than VS Code result/visualization fixtures.

## 0.1.2

### Added

- Saved geospatial and temporal visualization artifacts, including arced airport routes.
- First-class AntV G6, G2, and L7 renderer options alongside Cytoscape, Sigma, and Plotly.
- Renderer-specific loading and lifecycle status for graph, chart, map, and timeline views.
- A Python/Jupyter air-routes analysis that uses the same sample data as the extension.
- Package-content verification before VSIX packaging.

### Changed

- Restored Cytoscape and Plotly as the default graph and chart renderers.
- Replaced the startup mode chooser with an artifact-backed path from environment to saved views.
- Start Projects, Ontology, and Knowledge sections collapsed.
- Kept all sample visualizations explicit and reopenable from project artifacts.

### Fixed

- Reopening saved visualizations now follows the same renderer-ready lifecycle as the E2E path.
- Existing quickstart projects repair newly added sample artifacts without replacing user results.
- Release packages exclude private review, agent, and local-workspace material.

## 0.1.1

### Changed

- Initial Marketplace and Open VSX release of GraphForge for VS Code.
