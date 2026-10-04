# Changelog

All notable changes to the GraphForge VS Code extension are documented here.

## Unreleased

### Added

- **GraphForge: Visualize Result with XYG…** draws algorithm and search results with XYG. Rust composes them over the current graph:
  - scores and communities;
  - paths, walks, and cycles in order;
  - similarity and flow as dashed derived edges;
  - trees and matchings on the real relationships.
- Scalar and category results open as tables or bar charts, and embeddings as parallel coordinates. You choose the view; nothing is guessed.
- `graphforge.visualization.xygHost` chooses where XYG runs: the native core in the extension host (default, any size) or WebAssembly in the view. Neither falls back to the other.

### Changed

- Results keep their GraphForge Arrow schema and are bound to a result id and graph generation. Run Query also saves the exact engine bytes as `results/*.arrow`.
- Show Result Graph and the open-after-query setting send algorithm results to XYG. Cypher results keep the Result Graph renderer.
- A result computed before the graph changed is refused as stale instead of being drawn over the newer graph.
- Table and view selections link by UUID and result row, and only between views of the same result.
- Tables without graph identity no longer open a demo graph; they report why and what to do instead.

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
