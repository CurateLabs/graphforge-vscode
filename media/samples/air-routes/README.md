# Air Routes (US subset)

Real-world airline route graph used by GraphForge **Try sample project** / e2e.

`project/` contains the reusable `queries/templates/routes-overview.cypher`
query, a small documented route-activity result, and seven visualization specs:
a default v2 Cytoscape graph; explicit v2 G6 graph, G2 chart, L7 map, and G2
timeline examples; plus v1 Cytoscape and Plotly compatibility examples. Every
renderer, binding, layout, coordinate, and time choice is visible in those
files.
`project/notebooks/air-routes-analysis.ipynb` is the parallel analyst path. It
reads the copied CSVs with pandas, bulk-builds the graph through GraphForge
Python, runs native PageRank, renders Plotly in VS Code Jupyter, and writes a
normal result plus Plotly visualization spec back into the sample project.
During creation, the extension also copies this dataset to
`data/air-routes/` and generates `mutations/seed-air-routes.cypher` before
executing that project-backed mutation.

`project/results/route-activity.json` is a small illustrative timeline fixture,
not a claim about the historical air-routes source. It is committed separately
so its synthetic monthly values and UTC timestamps are visible rather than
generated invisibly by extension code.

| File | Rows | Role |
| --- | --- | --- |
| `airports.csv` | 586 | US airports (`Airport` nodes) |
| `routes.csv` | 7,430 | Domestic US routes (`ROUTE` edges with `dist` miles) |

## Provenance

Derived from Kelvin R. Lawrence’s **air-routes** dataset
([krlawrence/graph](https://github.com/krlawrence/graph)), Apache License 2.0.
See `NOTICE` and `LICENSE` in this directory.

## Regenerate from upstream

```bash
curl -fsSL -o /tmp/air-nodes.csv \
  https://raw.githubusercontent.com/krlawrence/graph/master/sample-data/air-routes-latest-nodes.csv
curl -fsSL -o /tmp/air-edges.csv \
  https://raw.githubusercontent.com/krlawrence/graph/master/sample-data/air-routes-latest-edges.csv
# filter country==US airports and US–US routes into airports.csv / routes.csv
```

Or run `node scripts/seed-quickstart-sample.mjs` after updating the CSVs here.
