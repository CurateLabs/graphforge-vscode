# Changelog

All notable changes to the GraphForge VS Code extension are documented here.

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
