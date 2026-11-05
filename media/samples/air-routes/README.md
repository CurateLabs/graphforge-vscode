# Air Routes (US subset)

Real-world airline route graph used by GraphForge **Try sample project** / e2e.

`project/` contains the route query and four XYG intents: network, distance
histogram, geographic routes and an illustrative timeline. Core retains the
canonical result as Arrow; XYG composes and paints every view. The route query
returns 579 connected airports; seven source airports have no returned route.
The Python notebook and Streamlit app use the same CSVs, GraphForge PageRank
and XYG's public composition API. Creation copies data under `data/air-routes/`
and generates the reviewed seed under `mutations/`.

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
