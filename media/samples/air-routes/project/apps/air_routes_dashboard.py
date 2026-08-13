"""Portable Streamlit dashboard for the GraphForge air-routes Python sample.

Run from any terminal (VS Code is not required):

    uv run --with streamlit --with graphforge --with pandas --with plotly \
      streamlit run apps/air_routes_dashboard.py
"""

from __future__ import annotations

from pathlib import Path

import graphforge as gf
import pandas as pd
import plotly.express as px
import streamlit as st


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = PROJECT_ROOT / "data" / "air-routes"


@st.cache_data(show_spinner="Running native PageRank with GraphForge…")
def ranked_airports(data_root: str) -> pd.DataFrame:
    airports = pd.read_csv(Path(data_root) / "airports.csv")
    routes = pd.read_csv(Path(data_root) / "routes.csv")

    forge = gf.GraphForge()
    try:
        receipt = forge.add_nodes(
            "Airport",
            airports.rename(columns={"id": "source_id"}),
            operation_uuid="018f0f4e-7b8c-7000-8000-00000000a101",
        )
        airport_uuid_by_id = dict(zip(airports["id"], receipt.column("entity_uuid").to_pylist()))
        route_batch = (
            routes.assign(
                src_id=routes["from"].map(airport_uuid_by_id),
                dst_id=routes["to"].map(airport_uuid_by_id),
            )
            .drop(columns=["from", "to"])
        )
        forge.add_edges(
            "ROUTE",
            route_batch,
            operation_uuid="018f0f4e-7b8c-7000-8000-00000000a102",
        )
        ranked = (
            forge.rank("Airport", by="pagerank", via="ROUTE", directed=True)
            .to_pandas()
            .sort_values(["score", "code"], ascending=[False, True])
            .reset_index(drop=True)
        )
    finally:
        forge.close()

    ranked["rank"] = ranked.index + 1
    return ranked.loc[:, ["rank", "code", "city", "region", "score", "lat", "lon"]]


st.set_page_config(page_title="GraphForge air-routes", page_icon="✈️", layout="wide")
st.title("US air-routes: native GraphForge PageRank")
st.caption(f"Project: {PROJECT_ROOT}")
st.caption("This is a portable Python/Streamlit app. It does not use VS Code result or visualization panels.")

if not DATA_ROOT.exists():
    st.error(f"Missing copied sample data: {DATA_ROOT}")
    st.stop()

ranked = ranked_airports(str(DATA_ROOT))
regions = sorted(ranked["region"].dropna().unique())
selected_regions = st.sidebar.multiselect("Regions", regions, default=regions)
limit = st.sidebar.slider("Airports to show", min_value=5, max_value=100, value=25, step=5)
visible = ranked[ranked["region"].isin(selected_regions)].head(limit)

left, right = st.columns([3, 2])
with left:
    chart = px.bar(
        visible,
        x="code",
        y="score",
        color="region",
        hover_data=["city", "rank"],
        title="Top US airports by PageRank",
        labels={"code": "Airport", "score": "PageRank", "region": "Region"},
    )
    chart.update_layout(xaxis_categoryorder="array", xaxis_categoryarray=visible["code"])
    st.plotly_chart(chart, use_container_width=True)
with right:
    st.metric("Airports ranked", f"{len(ranked):,}")
    st.metric("Routes loaded", "7,430")
    st.dataframe(visible, use_container_width=True, hide_index=True)

st.download_button(
    "Download visible rankings as CSV",
    visible.to_csv(index=False).encode("utf-8"),
    file_name="air-routes-pagerank.csv",
    mime="text/csv",
)
