# Air Routes (US subset)

Real-world airline route graph used by GraphForge **Try sample project** / e2e.

`project/` contains the reusable `queries/templates/routes-overview.cypher`
query and Result Graph/Plotly visualization specs copied into a new sample.
During creation, the extension also copies this dataset to
`data/air-routes/` and generates `mutations/seed-air-routes.cypher` before
executing that project-backed mutation.

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
