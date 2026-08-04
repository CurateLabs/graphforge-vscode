# Python dashboard

Run the portable air-routes dashboard from the sample project root:

```bash
uv run --with streamlit --with graphforge --with pandas --with plotly \
  streamlit run apps/air_routes_dashboard.py
```

It reads the copied CSVs, runs native GraphForge PageRank through Python, and
opens an interactive Plotly dashboard in a browser. It does not require or
write VS Code result-panel or visualization artifacts.
