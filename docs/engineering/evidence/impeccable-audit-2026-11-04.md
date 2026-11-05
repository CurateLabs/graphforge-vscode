# GraphForge VS Code — Impeccable technical audit

Date: 2026-11-04. Source: `49e7d7a`, branch `t3/show-dataset-extension`.
Mode: **Operate**. Scope: sample/Get Started, Results, Entity Inspector, and the owning XYG panel/transport code. This is an audit, not a redesign or implementation pass.

## Implementation integrity verdict

**Fail for behavioral integrity; preserve the existing visual system.** The interface has a coherent analyst-workbench identity: VS Code theme tokens, native controls, a persistent setup journey, real project artifacts, canonical identity, and a useful Inspector. However, normal keyboard actions are intercepted, row selection defeats the rendering bound, and the form offers graph filtering and temporal granularity that the downstream path cannot honor.

The source detector produced one warning: `side-tab` at `webview-ui/src/getStarted/getStarted.css:33` (`.ready-summary`'s accent border). This is a contextual false positive: a small completion-state cue in the established system. It is not evidence for changing the design or counted as an issue.

## Audit health score

| Dimension | Score | Evidence |
| --- | ---: | --- |
| Accessibility | 2/4 | Native labels, focus outlines and status regions exist, but Results keyboard activation and selected-text contrast fail. |
| Performance | 2/4 | Initial rendering is capped at 500 rows; graph-linked selection can remove that bound and rebuild every preceding row. |
| Theming | 2/4 | Most chrome uses VS Code tokens; selected-value foregrounds and XYG high-contrast/theme changes are incomplete. |
| Responsive design | 3/4 | Sampled 320px forms and Inspector reflow without page overflow; wide Results remain inside their own scroll region. Native zoom/touch remain unqualified. |
| Implementation integrity | 2/4 | Several UI promises diverge from the actual saved intent and render requirements. |
| **Total** | **11/20** | **Acceptable — significant work needed. Provisional, not release or WCAG certification.** |

Issues: **10 total — P0: 0; P1: 4; P2: 6; P3: 0.**

## Evidence and limits

Current compiled `dist/webview-ui` JavaScript/CSS ran in the T3 Chromium preview with a VS Code-message shim. The fixtures use the real public MHK sample entity for display checks and a separately labeled synthetic two-column dataset for the performance check. The Results shell retains the current host markup. Representative dark/light VS Code token palettes were supplied; these are component-fixture observations, not native VS Code screenshots or a guarantee for every theme.

Checks included real browser Enter-key actions, focus inspection, DOM bounds/counts, selected-text contrast, and 320/1280 CSS-pixel widths. The source detector scanned the four UI directories and `src/webview/xygPanel.ts`. Its documented `--cdp 9222 --target GraphForge` mode is unavailable in the installed binary: it reported `cannot access 9222` and `cannot access GraphForge`, interpreting the arguments as file targets. No successful desktop CDP scan is claimed.

Screen-reader behavior, physical devices, synthesized touch gestures, actual browser text zoom, native theme switching and high-contrast pixel contrast were not qualified. XYG itself was source-reviewed at the extension integration boundary; its native painter was not requalified by this audit. The preview tab was temporary and closed after inspection. The existing VS Code demo and its project were left untouched.

Compiled JavaScript SHA-256:

- Results: `16ccba73e1ee6bf47bef2c0553a8be0cd6db5d7a8948c39653b7d38f7ee77b96`
- Inspector: `f8c07a996293e1e7faeb040bd031639b4d8d6ac2a6d7495ad19448a4f40130a3`
- Get Started: `579078306849cc3a42b35ac9ff9847b3a404890ce526ed88bed30bcc8a773924`

## P1 — address before release

### F1. Results intercepts keyboard activation of child controls

**Location:** `webview-ui/src/results/main.ts:162`.
**Category:** Accessibility. **Standard:** WCAG 2.1.1 Keyboard (Level A).

The row handler handles bubbled Enter/Space from every descendant and calls `preventDefault`. In the current compiled component, focusing an Inspect button and pressing Enter emitted only `graphforge/selectResult`; it did not emit `graphforge/openResultEntity`. Enter on a nested value summary also selected the row and left its details closed. Keyboard users cannot perform operations that pointer users can.

**Recommendation:** Handle row activation only when the row itself is the keyboard target, preserving native button/summary behavior. Verify both Enter and Space with actual browser key events.
**Suggested command:** `$impeccable harden`.

### F2. Selected Results rows lose text contrast

**Location:** `webview-ui/src/results/results.css:219`, `:229`, `:239`.
**Category:** Accessibility / Theming. **Standard:** WCAG 1.4.3 Contrast (Minimum), Level AA.

Selection changes cell backgrounds while ordinary, numeric, boolean and structured-summary foreground colors remain independent. Only the row-number cell adopts the active-selection foreground. In the representative Light+ token fixture, 12px numeric text `rgb(9,134,88)` against selected `rgb(0,96,192)` measured **1.33:1**, below 4.5:1. Selection makes the selected data harder to read.

**Recommendation:** Apply a coherent selected-row foreground policy to text and semantic values, while retaining appropriate button backgrounds/foregrounds. Check selected, hovered and focused states across real light/dark/high-contrast themes.
**Suggested command:** `$impeccable colorize`.

### F3. Linked selection bypasses the Results rendering limit

**Location:** `webview-ui/src/results/main.ts:228`, with repeated key enumeration at `:126` and full body replacement at `:170`.
**Category:** Performance.

Selecting row 7,429 sets `renderedRows = first + 1`, rendering the entire prefix. A single synthetic 7,430-row/two-column check grew from **500 rows / 5,531 elements / 135ms** to **7,430 rows / 81,761 elements / 3,081.5ms**. These are synchronous handler timings on one browser run, not a general performance claim. `Object.keys(entityLinks)` also allocates and enumerates all link keys once per rendered row.

**Recommendation:** Reveal a bounded page/window around the selection, rather than every preceding row. Compute link presence once per render and avoid rebuilding the whole prefix for Show more. Retain accessible table semantics and exact row identities.
**Suggested command:** `$impeccable optimize`.

### F4. The creation form offers unsupported graph filters

**Location:** `webview-ui/src/getStarted/main.js:95`, `:268`; `src/commands/projectArtifacts.ts:167`, `:399`; `src/webview/xygRuntime.ts:51`.
**Category:** Implementation Integrity.

The graph form visibly accepts a filter and posts it to `graphforge.createProjectVisualization`. The command saves that filter, but XYG graph input explicitly rejects host row filters. The open path filters rows first and strips IPC, so the user can receive `XYG_ARROW_REQUIRED` instead of the graph-filter explanation. The rendered form was verified to submit a region filter for `kind: result-graph`.

**Recommendation:** Do not offer host row filters for graphs; explain that the Cypher query controls graph filtering. Reject incompatible command/spec input before saving an unusable artifact. Preserve chart/map/temporal filtering where supported.
**Suggested command:** `$impeccable harden`.

## P2 — next focused pass

### F5. Graph readiness is inferred from filenames

**Location:** `src/session/projectArtifacts.ts:26`, `:307`; `src/views/getStartedContent.ts:73`, `:177`; `webview-ui/src/getStarted/main.js:140`.
**Category:** Implementation Integrity / onboarding.

The result index exposes columns/count, without whether canonical Arrow is available or whether the schema can feed a graph. Get Started enables saved views based on result-path existence. JSON-only results therefore look ready and fail later. This is verified from source; a new end-to-end missing-Arrow scenario was not rerun during this audit.

**Recommendation:** Expose graph-readiness and actionable reasons separately from table availability. Offer an explicit rerun of the originating query when that provenance exists, without automatically executing arbitrary saved queries.
**Suggested command:** `$impeccable onboard`.

### F6. Entering Inspector edit mode drops focus to the document body

**Location:** `webview-ui/src/entityInspect/main.ts:242`, `:289`.
**Category:** Accessibility. **Standard:** focus-order/context concern under WCAG 2.4.3; no complete conformance claim.

The entire Inspector DOM is replaced on Edit and state updates. In the compiled component, keyboard-activating Edit left `document.activeElement` at `BODY`, with the editor present but unfocused. Save/cancel state transitions use the same replacement pattern.

**Recommendation:** Preserve a deliberate focus destination: editor on entry, heading/Edit after cancellation or successful save, and validation/editor after failure. Associate help/error text with the editor.
**Suggested command:** `$impeccable harden`.

### F7. XYG scene theme is incomplete and does not track theme changes

**Location:** `src/webview/xygPanel.ts:370`; `webview-ui/src/xyg/main.ts:143`.
**Category:** Theming.

The host maps only `ColorThemeKind.Light` to light; `HighContrastLight` falls into dark. The webview also recognizes only `vscode-light` before choosing hard-coded white or `#111827`. No extension listener updates the native scene on active-color-theme changes. This is source-confirmed; actual native high-contrast contrast and switching were not exercised.

**Recommendation:** Handle both high-contrast variants explicitly and regenerate the existing scene when the host theme changes. Use host theme tokens for surrounding surfaces; keep scene palette/rendering in XYG.
**Suggested command:** `$impeccable colorize`.

### F8. Temporal granularity is a nonfunctional control

**Location:** `webview-ui/src/getStarted/main.js:91`, `:304`; `src/commands/projectArtifacts.ts:210`.
**Category:** Implementation Integrity.

The rendered form sends `granularity: month`, but the host argument type and temporal intent creation do not consume it. Users can believe day/hour/month changes their view when the control has no effect.

**Recommendation:** Remove the control until a supported XYG operation owns it, or wire the explicit semantic operation through the appropriate contract. Do not silently invent a host aggregation.
**Suggested command:** `$impeccable distill`.

### F9. Results forces smooth scrolling for linked selections

**Location:** `webview-ui/src/results/main.ts:240`.
**Category:** Accessibility / motion. **Standard:** reduced-motion preference support; no AA violation asserted solely from this behavior.

`scrollIntoView` always requests smooth motion. Results has no reduced-motion branch, although the Inspector and XYG Fit control already provide examples of honoring that preference.

**Recommendation:** Use immediate scrolling under reduced motion, preserving the selected-row highlight and status message. Verify the preference with actual browser media emulation when available.
**Suggested command:** `$impeccable animate`.

### F10. Adding a query template can change the sample action

**Location:** `src/views/getStartedView.ts:194`.
**Category:** Implementation Integrity / onboarding.

“Run sample query” chooses the first sorted template rather than the known sample query. A new `aaa-analysis.cypher` would change that action's target. The source selection rule is verified; the customized-project scenario was not executed.

**Recommendation:** Resolve the specific sample template and show a clear recovery if it is missing, while leaving analyst templates independently available.
**Suggested command:** `$impeccable onboard`.

## Patterns and positives

The main pattern is a mismatch between control availability, host capability, and render requirements. Accessibility regressions cluster around event delegation and wholesale DOM replacement. Performance bounds exist for initial rendering but are not invariants shared by selection and pagination. Scene and chrome theme handling need a coordinated lifecycle.

Preserve these strengths:

- Actual semantic buttons, labeled form controls, table headers and Inspector definition lists.
- Clear MHK heading, separate canonical UUID, retained properties and inspect actions.
- VS Code theme tokens across most chrome, visible focus styles, and live status regions.
- Correct opaque sticky Results cells; the prior text/button overlap did not recur in the sampled state.
- Inspector properties stack at 320px; its desktop content stays bounded at 760px.
- Get Started geospatial controls stayed within 320px; Results horizontal scrolling remained inside its table region.
- Original Arrow validation and the single XYG renderer boundary remain intact.

Small controls are appropriate to a desktop editor; 22px buttons are not automatically treated as a mobile/WCAG failure. The source detector's accent-border warning and the fixture's intentionally missing logo URI are not counted as product defects.

## Recommended sequence

1. **P1 — `$impeccable harden`**: preserve Results child keyboard activation and reject unsupported graph filters before saving; restore Inspector focus in the same behavioral pass.
2. **P1 — `$impeccable optimize`**: enforce bounded row rendering during linked selection and remove repeated full link-key enumeration.
3. **P1/P2 — `$impeccable colorize`**: fix selected-row foregrounds, then XYG theme/high-contrast lifecycle.
4. **P2 — `$impeccable onboard`**: expose graph readiness/recovery and pin the sample action to its real template.
5. **P2 — `$impeccable distill`**, then **`$impeccable animate`**: remove ineffective granularity and honor reduced-motion scrolling.
6. **Final — `$impeccable polish`**: verify the completed flows in real VS Code at narrow and wide panel sizes.

Re-run `$impeccable audit` after fixes. No UI code, project data, settings, or GitHub objects were changed by this audit.
