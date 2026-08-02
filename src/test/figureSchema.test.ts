import * as assert from "node:assert/strict";
import {
  enforceFigureLimits,
  validateAndLimitFigure,
  validateFigure,
} from "../webview/figureSchema";

suite("figureSchema validate + limits (#62)", () => {
  const good = {
    data: [{ type: "bar", x: ["a", "b"], y: [1, 2] }],
    layout: { title: { text: "t" } },
  };

  test("accepts well-formed figures and rejects garbage", () => {
    const ok = validateFigure(good);
    assert.equal(ok.ok, true);
    assert.equal(validateFigure(null).ok, false);
    assert.equal(validateFigure({ layout: {} }).ok, false);
    assert.equal(validateFigure({ data: ["nope"] }).ok, false);
  });

  test("limits default path is a no-op when disabled", () => {
    const result = validateAndLimitFigure(good, {
      enabled: false,
      maxTraces: 1,
      maxPoints: 1,
      maxBytes: 1,
    });
    assert.equal(result.ok, true);
  });

  test("limits fail closed when enabled", () => {
    const tooManyTraces = enforceFigureLimits(
      {
        data: [
          { type: "bar", x: [1], y: [1] },
          { type: "bar", x: [2], y: [2] },
        ],
      },
      { enabled: true, maxTraces: 1, maxPoints: 100, maxBytes: 1_000_000 },
    );
    assert.equal(tooManyTraces.ok, false);
    if (!tooManyTraces.ok) {
      assert.equal(tooManyTraces.code, "FIGURE_LIMITS");
    }

    const tooManyPoints = enforceFigureLimits(
      { data: [{ type: "scatter", x: [1, 2, 3], y: [1, 2, 3] }] },
      { enabled: true, maxTraces: 10, maxPoints: 2, maxBytes: 1_000_000 },
    );
    assert.equal(tooManyPoints.ok, false);
  });
});
