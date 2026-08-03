# Get Started design QA

## Comparison evidence

- Source visual truth: `/Users/davidspencer/.codex/generated_images/019fc2ef-c3e0-7982-b174-c1c5478b3f11/exec-1b80fd0c-5fd4-46ef-97ba-af375ef3b8b8.png`
- Earlier AntV comparison capture: `onboarding-design-qa/implementation-e2e-g6.jpeg`
- Source pixels: 779 x 2018. Implementation capture: 1229 x 768 at the live VS Code Extension Development Host viewport.
- Density normalization: the implementation's GraphForge activity-bar column is approximately 296 CSS pixels wide; the source is a high-density single-column concept. Comparison therefore uses the source column against the implementation's left sidebar, not the unrelated editor, Results panel, or Chat surfaces in the full-host screenshot.
- Tested state: completed quickstart path with the durable query result restored. The current quickstart E2E opens the default saved v2 Cytoscape artifact and waits for its terminal readiness contract; the earlier image remains evidence of the explicit G6 path. The source depicts Environment as current; the different state is intentional and verifies that the same persistent spine survives completion.

## Mandatory comparison passes

| Surface | Evidence and result |
| --- | --- |
| Typography | Uses the VS Code font tokens at a compact sidebar scale. Heading, step title, detail, and artifact-path hierarchy remain distinct and readable at the live 296 px column width. No clipped or overlapping text was observed. |
| Spacing and layout | The implementation preserves the selected concept's centered hero, vertical five-node spine, one numbered marker per step, attached descriptions, and in-context primary action. It intentionally compresses vertical gaps to keep the entire path and the three closed supporting sections visible in a normal-height workbench. |
| Viewport resilience | Verified in the real narrow VS Code primary sidebar. Long project and artifact paths wrap within the column. Buttons remain inside the view, and Projects, Ontology, and Knowledge remain collapsed. |
| Colors and tokens | Accent, foreground, muted copy, border, button, error, and focus colors use VS Code theme tokens. Completed nodes use the GraphForge accent; current state uses the accent ring. No design-only hardcoded dark surface was introduced. |
| Image and icon fidelity | The real packaged `media/graphforge.svg` is used. Existing VS Code title-action icons remain native. No custom CSS art, inline SVG substitute, fake artifact icon, or decorative blob was added. |
| Copy and content | Replaced invented time estimates and the nonexistent `.graphforge/env.json` with truthful live progress, the selected runtime, the actual `FORMAT` marker, and real project artifact paths. |
| States and interactions | Verified Project current, Query current, query completion, saved result restoration, completed path, and saved visualization reopening through a terminal readiness wait. Missing visualization sources render a disabled `Needs result` control with an explanation. Every command now produces inline working/success/error status instead of appearing inert. |
| Accessibility | Uses an ordered list, `aria-current="step"`, screen-reader-only status labels, a polite live journey status, a polite command status, semantic buttons, disabled state, theme contrast tokens, and the packaged logo as intentionally decorative. |

## Findings and fixes

1. **P1, behavior:** the quickstart advertised `visualizations/airports-map.gfviz.json` before its referenced `results/query-result.json` existed. Clicking Open returned an artifact error and looked inert. Fixed by selecting only a resolvable result/visualization pair for journey progress and disabling unresolved visualization rows with explicit source-result copy.
2. **P1, artifact visibility:** scanning hid `results/query-result.json` whenever another named result existed. This removed the real routes result from Result History and prevented the journey from recognizing it after the query completed. Fixed by listing every valid durable result.
3. **P2, feedback:** Get Started fire-and-forgot commands and did not surface structured command outcomes inside the view. Fixed with an inline live action status that reports working, success, and error states.
4. **P1, E2E parity:** the journey chose the first matching artifact alphabetically and returned before renderer readiness, while the E2E deliberately opens the saved v2 Result Graph and waits for `renderReady` or `renderFailed`. Fixed by preferring the saved v2 graph for the configured renderer, passing the E2E readiness options, and treating a terminal renderer failure as an inline action error.
5. **P1, Cytoscape readiness:** renderer, options, and graph protocol messages each rebuilt the dense graph while opening a saved artifact. Fixed by applying those messages as one render snapshot so one open produces one layout and one terminal lifecycle.

## Post-fix verification

- The sample initially stops at Query and names `queries/templates/routes-overview.cypher`.
- Running it produced and displayed `results/query-result.json` with 7,430 rows and 10 columns.
- The completed journey names `visualizations/routes-network-default.gfviz.json`.
- **Open saved visualization** and the E2E both open **US routes network — Cytoscape**, wait for the same terminal lifecycle, and report ready only after the 579-node / 7,430-edge graph completes its render path.
- The live Extension Host log set was checked for `ERROR`, `Unhandled`, and `renderFailed`; no matches were present after the verified path.
- Unit/type checks passed after the fixes; full repository and packaging gates are recorded in the task handoff.

final result: passed
