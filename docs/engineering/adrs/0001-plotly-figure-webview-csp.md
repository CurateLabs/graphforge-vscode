# ADR-0001: Plotly Figure webview under Settings-strict CSP

- Status: Accepted
- Date: 2026-08-01
- Issue: [#62](https://github.com/CurateLabs/graphforge-vscode/issues/62)

## Context

GraphForge needs an analytical Figure panel that renders Plotly figure JSON for
both human and agent callers. VS Code webviews use a restrictive CSP. The
Settings panel already ships a strict policy (`script-src` nonce only,
`style-src` = `webview.cspSource`, no CDN). Plotly.js historically injected
inline styles; recent builds ship `dist/plotly.css` and can no-op
`addRelatedStyleRule` when a `plotly.js-style-global` style element exists.

Per #62, shipping with `style-src 'unsafe-inline'` is **not** an acceptable
success path. If Plotly cannot run under Settings-strict CSP, stop and choose
separate JS/Python replacements (not Dash-in-IDE).

## Decision

1. Bundle **full** `plotly.js` (`dist/plotly.min.js` + `dist/plotly.css`) into the
   Vite `figure` webview entry — no CDN.
2. Use Settings-strict CSP on the Figure panel, plus `img-src`/`worker-src`
   allowances Plotly needs for modebar icons and workers (`data:` / `blob:`).
3. Load bundled `plotly.css` from `webview.cspSource` and keep an empty
   `#plotly.js-style-global` style node so Plotly skips inline style injection.
4. Treat this spike as **pass** for proceeding with #62 implementation. Manual
   Extension Host confirmation (modebar + light/dark) remains part of QA.

## Consequences

- VSIX size grows with full plotly.js (accepted by #62).
- Figure is a separate surface from Result Graph (FR-7 / Cytoscape-bound).
- If field QA finds modebar/theme breakage under this CSP, open a follow-up for
  non-matching JS and Python renderer replacements rather than relaxing CSP or
  embedding Dash.
