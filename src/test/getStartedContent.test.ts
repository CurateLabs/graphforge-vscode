import * as assert from "node:assert/strict";
import { EXPERIENCE_MODE_CARDS } from "../session/experienceMode";
import { renderModeCardsHtml, runtimeStepActions } from "../views/getStartedContent";

suite("getStartedContent", () => {
  suite("runtimeStepActions", () => {
    test("done step emits no setup actions (#29)", () => {
      for (const kind of ["python", "node", "ambiguous"] as const) {
        const actions = runtimeStepActions(true, kind);
        assert.equal(actions.primaryAction, undefined, `primary leaked for ${kind}`);
        assert.equal(actions.secondaryAction, undefined, `secondary leaked for ${kind}`);
      }
    });

    test("Python-first workspace leads with Setup Python (#37)", () => {
      const actions = runtimeStepActions(false, "python");
      assert.equal(actions.primaryAction?.label, "Setup Python");
      assert.equal(actions.primaryAction?.command, "graphforge.setupPythonBinding");
      assert.equal(actions.secondaryAction?.label, "Setup Native (Node)");
      assert.equal(actions.secondaryAction?.command, "graphforge.setupNativeBinding");
    });

    test("Node-ish and ambiguous workspaces keep the Node-first CTA", () => {
      for (const kind of ["node", "ambiguous"] as const) {
        const actions = runtimeStepActions(false, kind);
        assert.equal(actions.primaryAction?.label, "Setup Native (Node)");
        assert.equal(actions.primaryAction?.command, "graphforge.setupNativeBinding");
        assert.equal(actions.secondaryAction?.label, "Setup Python");
        assert.equal(actions.secondaryAction?.command, "graphforge.setupPythonBinding");
      }
    });
  });

  suite("renderModeCardsHtml", () => {
    test("renders one radio per card with ARIA semantics (#26)", () => {
      const html = renderModeCardsHtml(EXPERIENCE_MODE_CARDS, "guided");
      const radios = html.match(/role="radio"/g) ?? [];
      assert.equal(radios.length, EXPERIENCE_MODE_CARDS.length);
      for (const card of EXPERIENCE_MODE_CARDS) {
        assert.ok(html.includes(`data-mode="${card.mode}"`), `missing card for ${card.mode}`);
        assert.ok(
          html.includes(`aria-labelledby="mode-title-${card.mode}"`),
          `missing accessible name for ${card.mode}`,
        );
        assert.ok(html.includes(card.title));
        assert.ok(html.includes(card.tagline));
      }
      // The hand-drawn radio circle is decoration only.
      assert.ok(html.includes(`class="radio" aria-hidden="true"`));
    });

    test("selected card is aria-checked and holds the roving tabindex", () => {
      const html = renderModeCardsHtml(EXPERIENCE_MODE_CARDS, "autonomous");
      assert.ok(
        html.includes(`aria-checked="true" tabindex="0" data-mode="autonomous"`),
        "selected card should be checked and focusable",
      );
      assert.ok(
        html.includes(`aria-checked="false" tabindex="-1" data-mode="guided"`),
        "unselected card should be unchecked and skipped by Tab",
      );
      assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1);
    });
  });
});
