---
target: Get Started sidebar
total_score: 21
p0_count: 0
p1_count: 5
timestamp: 2026-08-02T06-26-51Z
slug: src-views-getstartedview-ts
---
Method: dual-agent (A: assessment_a · B: assessment_b)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|------:|-----------|
| 1 | Visibility of System Status | 2/4 | Checklist badges help, but commands have no local pending/disabled state, inline completion feedback, or live announcement. |
| 2 | Match System / Real World | 2/4 | Analyst-friendly project language gives way to `FORMAT`, bindings, `uv`, Cytoscape, Sigma, and force-layout mechanics too early. |
| 3 | User Control and Freedom | 2/4 | Mode and page switching exist, but Welcome is mandatory, long work has no cancel path, and in-surface navigation is absent. |
| 4 | Consistency and Standards | 3/4 | VS Code tokens and control styles are consistent; names drift across Figure/Chart/Plotly Figure and Try/Open Sample. |
| 5 | Error Prevention | 2/4 | Command guards exist, but unavailable actions remain interactive, layout numbers lack guidance, and repeated submissions are not prevented. |
| 6 | Recognition Rather Than Recall | 2/4 | The checklist and artifact history help, but Hub/Query/Visualize rely on icon-only title actions without a visible active state. |
| 7 | Flexibility and Efficiency | 2/4 | Palette commands and artifact shortcuts help, but there is no prominent resume-latest path, recent-project shortcut, or surfaced keyboard guidance. |
| 8 | Aesthetic and Minimalist Design | 2/4 | Welcome is focused; the hub and Visualize page flatten too many controls into repeated bordered modules and same-weight actions. |
| 9 | Error Recovery | 2/4 | Recovery returns users to Get Started, but the panel does not retain the failure reason or present the next corrective action. |
| 10 | Help and Documentation | 2/4 | Diagnostics and settings exist, but advanced visualization controls lack contextual explanation and task-focused help. |
| **Total** | | **21/40** | **Acceptable, but significant improvements needed** |

## Anti-Patterns Verdict

**LLM assessment:** Moderate fail. The VS Code-native restraint is appropriate, and the interface avoids gradients, glass, oversized radii, and decorative motion. The problem is its visual grammar: repeated rounded bordered modules, tiny uppercase tracked section labels, and dense groups of same-weight controls make a distinctive discovery workbench feel generically assembled. The implementation repeatedly applies the uppercase/tracked `.section-label` pattern to “Start here,” “Guided setup,” “Workbench,” “Draft query,” artifact groups, and visualization groups. The UI is competent, but not yet authored around the product’s “uncovering hunches” promise.

**Deterministic scan:** Clean. `detect.mjs` returned `[]` with exit 0 for both `src/views/getStartedView.ts` and the supporting `src/views/getStartedContent.ts`; no rule names, locations, or false positives were reported. This does not invalidate the qualitative finding: the narrow static detector did not flag the repeated template-string patterns and cannot evaluate state transitions, information architecture, or cognitive load.

**Visual overlays:** No reliable user-visible overlay is available. Assessment B opened the real GraphForge webview in a fresh VS Code Extension Development Host and confirmed the Welcome screen, radiogroup, selected Guided option, Autonomous option, Continue, Check Environment, and Settings through the accessibility tree and a screenshot. The `vscode-webview://` target was a cross-origin iframe with no mutable execution context, so script injection failed preflight; no live server was started and no overlay or `impeccable` console output was claimed.

## Overall Impression

The welcome state is calm, credible, and more accessible than the average extension onboarding surface. The experience deteriorates as soon as it must carry real work: guidance turns into a command launcher, advanced implementation choices surface too early, and the product misses its most important emotional beat—the first successful result. The biggest opportunity is to redesign the transition from first result to ongoing exploration so the sidebar always answers, “What did I just accomplish, and what should I investigate next?”

## What’s Working

- The starter project is concrete and reachable before runtime setup, and its queries/visualizations live in project artifacts instead of extension constants. That makes the sample feel like real work rather than a canned demo.
- The restrained VS Code token system and GraphForge indigo accent produce a credible light/dark foundation without ornamental styling.
- The mode selector uses real radio semantics, roving focus, `aria-checked`, and visible focus treatment. The real-webview accessibility snapshot confirmed the expected radiogroup and controls.

## Priority Issues

### [P1] The guided success step is modeled but never shown

**Why it matters:** After the first result, `hasLastResult` switches the layout to `hub`. At the same time, the model marks “See your results” as current and prepares Result Graph and Figure actions—but the renderer hides checklist steps in hub layout. The product discards its strongest post-query guidance at the exact peak moment users need it.

**Fix:** Keep guided layout until both result surfaces have been shown, or put a temporary “Your result is ready” module at the top of the hub with the sample-specific Result Graph and Figure actions. Transition to the general hub only after that handoff.

**Suggested command:** `$impeccable onboard`

### [P1] Navigation is icon-only and has no visible current location

**Why it matters:** Hub, Query, and Visualize live behind three view-title icons. The webview has no labeled tabs, breadcrumb, or active-page state, forcing first-timers to discover navigation by hover and returning users to remember icon meanings.

**Fix:** Add a compact labeled three-item tablist inside the webview with an active state and keyboard navigation. Keep the title icons as accelerators, not the sole navigation.

**Suggested command:** `$impeccable layout`

### [P1] The hub and Visualize page overload the analyst

**Why it matters:** Six result/exploration actions share one block, while Visualize exposes renderer choice, force mechanics, filters, and saving together. This makes the workbench feel like a graph administration panel rather than a concierge for investigating hunches.

**Fix:** Lead with current context and two or three next moves: reopen the latest table, view the graph, or create a chart. Move project switching, Find/Ontology, and additional tools into secondary groups. Put force parameters behind an “Advanced layout” disclosure with useful defaults.

**Suggested command:** `$impeccable distill`

### [P1] Commands lack local wait and recovery feedback

**Why it matters:** The originating button remains visually idle after posting a command, repeated clicks are possible, and recovery returns to Get Started without explaining the failure. A global status-bar spinner is easy to miss and does not reassure users that the engine is working rather than hung.

**Fix:** Track the active command in webview state; disable its control; show honest inline “Running…” or “Saving…” status in an `aria-live` region; and replace it with concise success or failure feedback plus the next action. Add cancellation only where the engine can truthfully support it.

**Suggested command:** `$impeccable harden`

### [P1] Visual hierarchy is not backed by semantic hierarchy

**Why it matters:** Step titles, control titles, and section labels are paragraphs; current/done status is visual; and dynamic refreshes are not announced. Keyboard operability is better than screen-reader orientation.

**Fix:** Use semantic headings, ordered-list semantics for setup, explicit accessible status text, `aria-current="step"`, and a scoped live region for relevant state changes.

**Suggested command:** `$impeccable audit`

## Cognitive Load

Seven of eight checks fail: single focus, chunking, visual hierarchy, one-thing-at-a-time, minimal choices, working memory, and progressive disclosure. Grouping is the one clear pass.

Decision points exceeding four visible options include:

- Pre-runtime setup: mode change, two starter actions, two runtime actions, a duplicated sample action, diagnostics, and settings.
- Post-result “Query and results”: six peer actions.
- Result Graph creation: name, result, view type, renderer, four layout fields, three filter controls, and Save & open.
- Query page: composer actions plus two actions per artifact row, with unbounded list growth and no recent-first disclosure.

## Emotional Journey

- **First open:** Calm and compact, but asks users to choose an operating policy before GraphForge has demonstrated value.
- **Setup:** The starter and progression feel concierge-like; runtime jargon and duplicate actions create the first “brittle” valley.
- **Success peak:** The intended “See your results” moment disappears into a six-action hub. This is the central journey failure.
- **Failure:** Recovery opens the correct surface but loses the reason and recommendation, so it is a destination rather than a recovery conversation.
- **Wait:** Global progress exists, but the initiating control remains inert and offers no local reassurance.
- **Return/end:** Artifact history exists, yet the hub does not foreground the latest project, question, or result. It ends as a command launcher rather than an invitation to the next investigation.

## Persona Red Flags

**Jordan — first-time analyst**

- “Setup Native (Node),” `FORMAT marker`, `@curatelabs/graphforge`, `uv`, Cytoscape, and Sigma assume implementation knowledge before the user sees value.
- “Try sample project” is duplicated before runtime is ready, while project actions remain clickable despite prerequisites.
- The first successful query removes “See your results” guidance and replaces it with six generic actions.
- Query and Visualize navigation depends on unlabeled view-title icons.

**Alex — experienced investigator / power user**

- Welcome forces mode selection and Continue before work can begin.
- There is no prominent resume-latest-result path, shortcut hint, or recent-project entry point.
- Six hub actions and icon-only navigation slow scanning.
- Query and visualization histories grow without filtering, pinning, or recent-first prioritization.

**Sam — accessibility-dependent analyst**

- The Welcome radiogroup is keyboard-operable—a real strength confirmed in the live webview.
- Setup current/done status is not programmatically labeled or announced.
- Only the main page title is a semantic heading; steps and controls flatten into paragraphs.
- Dynamic updates and command completion lack live announcements.
- Compact 11px controls were not verified under 200% zoom or custom high-contrast themes.

## Minor Observations

- Artifact names and paths are escaped, but other dynamic details are interpolated into `innerHTML` without the same escaping discipline; this is a hardening concern beyond visual critique.
- Artifact lists are complete and alphabetically sorted rather than recent-first, so large projects can turn the sidebar into a long file browser.
- Empty-state copy such as “No one-off queries in queries/” teaches directory structure more than user intent.
- Hard-coded indigo appears brand-correct, but custom-theme and high-contrast behavior was not visually verified.
- The quickstart end-to-end path does not test the rendered Get Started transition, keyboard traversal, semantic progress, or first-result handoff.

## Questions to Consider

- If onboarding is runtime → project → query → both result views, why does the product declare onboarding over at the query rather than after users see the result?
- Should Guided be assumed until GraphForge demonstrates value, instead of asking for an automation policy on first open?
- Is Get Started primarily onboarding or a persistent expert workbench? What explicit transition would let it serve both without compromising either?
- Do analysts need force-layout mechanics in the default path, or are implementation details masquerading as user choices?
- On return, should the hub begin with commands—or with the project, question, and result the analyst was last exploring?
