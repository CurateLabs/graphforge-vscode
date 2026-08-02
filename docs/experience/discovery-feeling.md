# Discovery feeling: exploring and uncovering hunches

## Observed need and evidence

ProductFeeling init (2026-08-01) with the maintainer. Stated north star: the VS Code
workbench should feel like **exploring and uncovering hunches**. Anti-goals: never
**complex** or **brittle**. Prior emotion audits in `.productfeeling/reviews/` already
framed Get Started as workbench-not-admin; this file locks the emotional jobs and
moment beats as experience source of truth.

This is maintainer-stated intent, not yet validated with external analyst interviews.

## Desired user and business outcome

An analyst who needs a different lens on their data can open GraphForge in VS Code,
feel guided (concierge) rather than overwhelmed, stay curious while querying and
running verbs, and leave each session ready for the next question—with trust from
clear results and clear failures, and without anxiety from silent hangs.

## Users and context

- **Primary (stated):** analysts / researchers working entity graphs, citation
  networks, and investigation projects as portable directories.
- **Secondary:** integrators / maintainers; coding agents (see
  [`agent-interop.md`](./agent-interop.md)).
- **Open:** proto-persona detail (segment, workflow today, buy/search language)
  is unvalidated — prefer customer discovery before locking ICP claims beyond
  [`../PRODUCT.md`](../PRODUCT.md).

## Emotional jobs (before / during / after)

| Phase | Feeling | Job |
|---|---|---|
| Before | Need a different way of looking at data; open to new perspectives | Give a calm on-ramp into GraphForge without admin-console theater |
| During | Curious and supported in discovery | Make Cypher, verbs, ontology, and epistemic status feel like tools for hunches |
| After | Empowered; ready for the next question | End every success (and recovery) with a clear next move |

## Moments that matter

| Moment | Beat | Design implication |
|---|---|---|
| First open | Premium hotel concierge; Kilo-like guided welcome | Get Started / Welcome: one composition, one primary CTA, guided checklist |
| Success | Clear next options | After query/verb: name what happened and offer obvious follow-ons |
| Failure | Easy recovery | Structured next action; never raw dumps as the only path |
| Wait | Understand real wait vs stuck | Progress / liveness signal for long analysis; never silent spin |
| Return | Easy new work *or* resume (Cursor-style open) | Recent projects / open / init paths as peers; low friction re-entry |

Reference pattern for return: Cursor’s open screen — primary actions for new work
plus a recent-projects list for resume, without burying either.

## Trust and anxiety

- **Builds trust:** clear results; clear failures.
- **Spikes anxiety:** hung analysis with no signal whether the engine is crunching
  hard or dead.

## Experience principles (feeling-derived)

1. **Hunch over admin** — every surface answers “what can I try next?” not “how do I
   administer a graph store?”
2. **Concierge without complexity** — guide the path; do not multiply controls or
   jargon.
3. **Fail clear, recover easy** — failures are legible and actionable.
4. **Honest waits** — long work announces itself; stuckness is distinguishable from
   progress.
5. **Return is first-class** — resuming a project is as easy as starting fresh.

## Intended behavior (feeling contract)

- First-run, missing-runtime, and no-project share one guided Get Started surface
  (see [`../DESIGN.md`](../DESIGN.md)).
- Success and failure paths always surface a next option.
- Long-running engine work should communicate activity (and ideally allow cancel /
  stuck detection) rather than an opaque wait.
- Return paths should present “open / resume recent” alongside “initialize / new”
  without a brittle maze.

## Open questions

- How far should concierge guidance extend past Get Started into verb QuickPicks
  and result panels?
- What concrete wait UX (heartbeat, elapsed time, cancel, “still working”) matches
  engine reality without lying?
- Which return-to-work affordances belong in Get Started vs VS Code’s own recent
  folders vs a GraphForge-specific recent-projects list?
- Validate “exploring hunches” language with real analysts before Marketplace copy
  hardens it.

## Related

- Feeling north star: [`../DESIGN.md`](../DESIGN.md#emotional-north-star)
- Positioning: [`../strategy/positioning.md`](../strategy/positioning.md)
- Agent loop (parallel consumer): [`agent-interop.md`](./agent-interop.md)
- Prior audits: `.productfeeling/reviews/graphforge-full-product-audit.md`,
  `.productfeeling/reviews/graphforge-vs-kilocode-audit.md`
