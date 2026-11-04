# Python dashboard

XYG is currently installed from the exact source commit used by the extension.
The source build needs Rust and Node/npm. In the sample project root, run:

```sh
uv run --with streamlit --with graphforge --with pandas --with "xyg @ git+https://github.com/CurateLabs/xyg.git@14e944b1b1e931e1e270d023c5b8fa5c5dce2d8d" \
  streamlit run apps/air_routes_dashboard.py
```

For the notebook kernel:

```sh
uv pip install --python /path/to/python graphforge pyarrow pandas ipykernel "xyg @ git+https://github.com/CurateLabs/xyg.git@14e944b1b1e931e1e270d023c5b8fa5c5dce2d8d"
```

The notebook writes CSV and self-contained XYG HTML under `notebooks/outputs/`.
The app embeds XYG HTML in Streamlit. Both use native GraphForge PageRank over
the copied CSVs and run independently of the VS Code visualization panels.
