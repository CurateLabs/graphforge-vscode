import * as assert from "node:assert/strict";
import {
  DEFAULT_EXPERIENCE_MODE,
  EXPERIENCE_MODE_CARDS,
  defaultsForExperienceMode,
  isExperienceMode,
  resolveExperienceMode,
} from "../session/experienceMode";

suite("experienceMode", () => {
  test("default mode is guided", () => {
    assert.equal(DEFAULT_EXPERIENCE_MODE, "guided");
  });

  test("resolveExperienceMode falls back to guided for missing/stale/corrupt values", () => {
    assert.equal(resolveExperienceMode(undefined), "guided");
    assert.equal(resolveExperienceMode(null), "guided");
    assert.equal(resolveExperienceMode(""), "guided");
    assert.equal(resolveExperienceMode("yolo"), "guided");
    assert.equal(resolveExperienceMode(42), "guided");
  });

  test("resolveExperienceMode passes through valid values", () => {
    assert.equal(resolveExperienceMode("guided"), "guided");
    assert.equal(resolveExperienceMode("autonomous"), "autonomous");
  });

  test("isExperienceMode narrows correctly", () => {
    assert.equal(isExperienceMode("guided"), true);
    assert.equal(isExperienceMode("autonomous"), true);
    assert.equal(isExperienceMode("high-autonomy"), false);
    assert.equal(isExperienceMode(undefined), false);
  });

  test("guided defaults confirm before Initialize, keep Result Graph closed, and don't auto-open projects", () => {
    const defaults = defaultsForExperienceMode("guided");
    assert.equal(defaults.confirmBeforeInitialize, true);
    assert.equal(defaults.openResultGraphOnQuery, false);
    assert.equal(defaults.autoOpenDetectedProject, false);
  });

  test("autonomous defaults skip the Initialize confirmation and auto-open results/projects", () => {
    const defaults = defaultsForExperienceMode("autonomous");
    assert.equal(defaults.confirmBeforeInitialize, false);
    assert.equal(defaults.openResultGraphOnQuery, true);
    assert.equal(defaults.autoOpenDetectedProject, true);
  });

  test("Welcome shows exactly one card per mode, each with short bullets", () => {
    assert.equal(EXPERIENCE_MODE_CARDS.length, 2);
    const modes = EXPERIENCE_MODE_CARDS.map((c) => c.mode).sort();
    assert.deepEqual(modes, ["autonomous", "guided"]);
    for (const card of EXPERIENCE_MODE_CARDS) {
      assert.ok(card.title.length > 0);
      assert.ok(card.tagline.length > 0 && card.tagline.length < 80);
      assert.ok(card.bullets.length > 0);
      for (const bullet of card.bullets) {
        assert.ok(bullet.length < 80, `bullet too long for panel copy: ${bullet}`);
      }
    }
  });
});
