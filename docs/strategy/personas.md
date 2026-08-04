# Proto-personas

## Status and evidence

These are behavioral **proto-personas**, not validated market segments. They
translate the stated audience of analysts and researchers into testable human
needs until interviews and observed sessions can confirm, split, or replace
them. They must not be used as settled buyer, pricing, or market claims.

Tools such as VS Code, notebooks, Streamlit, and coding agents are part of a
person's working context. They are not personas by themselves.

## Primary feeling

The experience should support **exploring and uncovering hunches**, with calm
guidance and earned trust as supporting tones.

## Key personas

| Persona | Before | During | After | Dangerous misread |
|---|---|---|---|---|
| **Graph-curious learner or evaluator** (entry persona) | Has a school assignment, research task, or work problem and wonders whether graph analysis might help. Fears investing too much time, choosing the wrong method, or looking unqualified because graph concepts are unfamiliar. | Needs to try a credible example, connect it to their own question, and achieve one meaningful result while understanding what happened. | Can make an informed decision: use graph analysis for this problem, keep learning, or choose another approach. | Treating them as a hobbyist with no real stakes, or assuming trial success means completing setup rather than learning something useful. |
| **Hunch-led analyst** (core primary) | Senses that relationships in the data matter but has not yet formed a precise question. Fears wasting time on setup and feeling incompetent around graph terminology. | Builds competence by moving from a broad curiosity to a visible pattern and a sharper next question. Needs guidance without surrendering control. | Feels oriented, capable, and eager to continue the investigation. | Assuming they arrived with a clean hypothesis or want to administer graph infrastructure. |
| **Evidence-driven researcher** (skeptical power user) | Has a tentative explanation and worries about mistaking an attractive pattern for a defensible finding. Their competence rests on methodological rigor. | Challenges provenance, meaning, assumptions, and alternative explanations. Needs the analysis to remain inspectable and reproducible. | Can state what the evidence supports, what it does not, and how the finding was produced. | Treating speed or visual impact as more valuable than traceability and epistemic restraint. |
| **Collaborative investigator** (anxious edge case) | Knows the work will pass between colleagues, tools, or agents. Fears context loss, invisible changes, and embarrassment when another person cannot reproduce the result. | Needs a shared record of questions, evidence, decisions, and unresolved threads. Wants help without losing authorship or accountability. | Can hand off the investigation and later understand what changed and why. | Assuming that proximity in the same IDE means collaborators share the same context. |

Workbench integrators remain an important secondary stakeholder, but they are
not a key experience persona. Their implementation decisions should be judged
against the four human lenses above.

## Collisions and precedence

- The graph-curious learner needs a bounded trial; the established analyst may
  want to start directly with their own material. The entry route must teach
  enough to support a real decision without becoming a compulsory tutorial.
- The hunch-led analyst benefits from momentum; the evidence-driven researcher
  needs deliberate challenge. Preserve a fast first exploration, then make the
  route to provenance, assumptions, and alternatives obvious.
- The guided analyst benefits from a recommended next step; power users need
  autonomy. Guidance should be dismissible through action, not through a
  permanent beginner/expert mode choice.
- Collaboration increases reach but can weaken ownership. Automation may help,
  while the human remains able to see, understand, and approve consequential
  changes.
- The **graph-curious learner is the primary entry lens**, and the **hunch-led
  analyst is the primary ongoing-work lens**. Required exceptions are rigor for
  the evidence-driven researcher and inspectability for the collaborative
  investigator. Violating these exceptions breaks trust rather than merely
  withholding convenience.

## Discovery questions

1. What school or work situations make someone consider graph analysis for the
   first time?
2. What result is meaningful enough for a learner to decide graph analysis is
   worth continuing?
3. How do analysts describe a “hunch” in their own language, and when does it
   become a claim?
4. What evidence makes a finding feel trustworthy enough to share?
5. Where does context usually disappear during collaboration or return visits?
6. Which parts of the current workflow feel empowering, and which make people
   feel technically exposed or dependent?

## Related

- [Positioning](./positioning.md)
- [Key journeys](../experience/key-journeys.md)
- [Discovery feeling](../experience/discovery-feeling.md)
