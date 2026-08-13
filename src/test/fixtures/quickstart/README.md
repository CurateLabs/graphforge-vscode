# Quickstart sample (#63)

The Get Started / e2e sample is the **vendored US air-routes** dataset:

`media/samples/air-routes/`

| File | Contents |
| --- | --- |
| `airports.csv` | 586 US airports |
| `routes.csv` | 7,430 domestic routes (`dist` miles) |
| `NOTICE` / `LICENSE` | Apache-2.0 attribution (Kelvin R. Lawrence / krlawrence/graph) |

Project content lives under `media/samples/air-routes/project/` and is copied
into each sample project:

| Path | Role |
| --- | --- |
| `queries/templates/routes-overview.cypher` | Reusable graph + chart query template |
| `visualizations/*.gfviz.json` | Result Graph and Plotly settings |
| `mutations/seed-air-routes.cypher` | Generated from the CSVs before execution |
| `data/air-routes/` | Copied source data and license files |

Smoke outside VS Code:

```bash
node scripts/seed-quickstart-sample.mjs /tmp/graphforge-quickstart
```
