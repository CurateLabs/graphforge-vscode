# Impeccable workbench hill climb — 2026-11-05

**Result: the ten original audit findings have recorded repairs and regression evidence. The previously reported 20/20 score is withdrawn.** Closing known findings does not establish maximum quality across the original five-dimension rubric. This report records bounded engineering verification; it is not WCAG conformance or the complete XYG release matrix.

Baseline: extension `49e7d7a`. XYG remains pinned, unchanged, at `18951e621e875407d0e40c35ccddf12d4b1a8def`.

## Regression evidence by dimension

| Dimension | Baseline | Current score | Recorded evidence |
| --- | ---: | ---: | --- |
| Accessibility | 2 | Not reassessed | Native Enter/Space activation, row navigation, focus/draft recovery, selected/expanded text contrast, motion preference and semantic status/labels pass the scoped checks. |
| Performance | 2 | Not reassessed | Every Results page stays at 500 rows or fewer, including linked selection; link-key enumeration is once per render. |
| Theming | 2 | Not reassessed | Token-controlled selected values, Inspect buttons, code surfaces and inputs; correct native-control color scheme; all four actual VS Code theme modes paint. |
| Responsive design | 3 | Not reassessed | 320/768/1280 CSS-pixel checks, 200% CSS zoom stress, long keys/labels/filenames, CJK/emoji values and errors stay contained. |
| Implementation integrity | 2 | Not reassessed | Offered controls match supported operations; graph admission is validated by XYG before save, readiness distinguishes Arrow from table-only data, recovery navigates safely to a source query. |
| **Total** | **11/20** | **Not reassessed** | **All ten known findings have repair evidence; this does not establish the absence of further findings.** |

## Original findings and recorded repairs

| Finding | Repair | Proof |
| --- | --- | --- |
| F1: nested Results controls lose keyboard activation | Row key handling only applies when the row itself is the target. Arrow/Home/End navigation keeps one row tab stop. | Real browser Enter and Space emit `graphforge/openResultEntity`; native value summaries expand; row arrows move focus. |
| F2: selected text contrast | Use the active-selection foreground for row values; use button foregrounds for Inspect and explicit foregrounds for expanded code surfaces. | Selected numeric text improved from 1.33:1 to 6.11:1. All 12 sampled component/theme cases pass text contrast. |
| F3: selection removes the row limit | Select a bounded page around the linked row; Previous/Next preserve absolute row numbers and accessible row indices. | Last-row selection renders 430 rows instead of 7,430. |
| F4: unsupported graph filters | Hide graph row filters and reject them before saving, replacing or applying them. Preflight graph composition uses XYG itself. | Unit no-write/replacement checks, installed command rejection, rendered form dispatch checks. Other semantic kinds retain their filters. |
| F5: filename-only graph readiness | Index `hasArrow`, preserve table-only inspection, offer source-query navigation, preflight graph compatibility before save. | Unit tests and rendered missing/empty-result recovery. Query provenance is only a project path; no automatic query execution or new parameter storage. |
| F6: Inspector loses edit focus | Move focus into the editor, preserve drafts and error association, restore Edit after save/cancel, avoid stealing focus from another document. | Browser invalid JSON, backend error and success checks preserve the expected focus. |
| F7: stale/misclassified themes | Handle HighContrastLight explicitly; regenerate on native theme events; use host surface tokens and matching native-control color schemes. | Actual installed VS Code light, dark, high-contrast dark and high-contrast light runs all acknowledge paint. |
| F8: nonfunctional granularity | Remove the ineffective control. UTC is readonly with an explanation. Require deliberate field choices and validate coordinate pairs. | Rendered control absence, required-field blocking and valid dispatch checks. |
| F9: forced selection motion | Use immediate Results scrolling under reduced motion; paint only the completed native graph layout and disable animated Fit when requested. | Browser preference-branch check; installed Chromium forced-reduced-motion run asserts `lifecycle.reducedMotion === true`. |
| F10: unstable sample action | Resolve the named sample template; provide a restore action if absent. | Native test adds an alphabetically earlier template and still selects the sample query; unit missing-template recovery check. |

The additional state sweep also fixed long property/badge/error overflow, selected JSON-block contrast, dark Inspect-button contrast, input borders and native-control theme selection. Loading disables unavailable controls; the timeline image-export button states the pinned engine limitation instead of offering an operation known to fail. Direct engine export failure semantics remain unchanged.

## Measurements

The same synthetic 7,430-row/two-column diagnostic produced:

| Linked last-row reveal | Before | After |
| --- | ---: | ---: |
| Rendered rows | 7,430 | 430 |
| DOM elements | 81,761 | 4,763 |
| Synchronous handler time | 3,081.5 ms | 57.8 ms |

These are single diagnostic runs, not repeated statistical benchmarks or a Core/XYG scale guarantee. The post-change initial page rendered 500 rows in 22.7 ms in that check.

Twelve current compiled component/theme fixtures cover Results, Inspector and Get Started in representative light/dark and both high-contrast token palettes. Minimum sampled text contrast is **4.99:1**, with **zero measured failures**. Expanded selected values were included. The fixtures use the actual compiled code and a VS Code message shim; they are not native desktop screenshots. Browser keyboard events are real key actions. The table reduced-motion check injects the preference branch; the installed host additionally exercises actual Chromium reduced-motion emulation.

## Verification and artifact

- **289 unit tests passed**, with one pre-existing optional Python probe pending.
- Type checks passed for host, webview and benchmark targets.
- Native source integration passed; installed VSIX integration passed in **49 seconds**, including query/Arrow persistence, edits in a temporary sample, independent views, exports, empty graph, four actual theme modes and reduced motion.
- The final wrapping-only CSS changes received rendered stress checks and a fresh installed-package smoke. That smoke reopened the original sample without rerunning its query: **579 nodes / 7,430 source rows**, real `graphforge/renderReady`.
- Package contents passed: **160 payload files / 10,259,196 bytes unpacked**; the VSIX has 162 archive entries.
- VSIX: `graphforge-xyg-darwin-arm64.vsix`.
- SHA-256: `eb60988bc9761f1a4f455a642f6326196a2191dbe7b12d42469a023802d1d91d`.
- Active Impeccable design hooks reported no deterministic issues on the final CSS edits. The original completion-state accent warning remains a documented contextual false positive; it was not cosmetically changed to improve the score.

The original public sample remains open in a fresh isolated installed host. Persistent user settings were not changed. No Core graph data was changed by the final smoke. No PR, merge, release publication or issue-state changes were performed.

## Boundaries

Physical screen-reader/touch testing and an independent WCAG conformance assessment remain outside this evidence. CSS zoom is a stress check, not OS/browser zoom certification. Native painter presentation parity, every algorithm, massive data, other OS/architectures and upstream time-axis image export retain their separate qualification requirements. The UI makes the time-axis export limitation explicit.

The original audit already excluded native painter requalification, touch and screen-reader qualification. The main correction is to the scoring inference, rather than a newly reduced scope. Theme paint acknowledgements prove successful rendering, not native pixel contrast or presentation correctness. The detailed JSON component/theme matrix covers three surfaces at 320 CSS pixels; wider layouts and CSS zoom are summarized checks rather than per-case records.

A future scored reassessment must define the applicable desktop criteria and coverage before testing, map evidence and unassessed cases to each dimension, and retain the original rubric or explicitly identify a replacement. This regression report must not be used as global XYG release acceptance.

See the adjacent JSON for the recorded component/theme measurements, and the 2026-11-04 audit for the original findings.
