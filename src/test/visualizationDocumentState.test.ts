import * as assert from "node:assert/strict";
import { VisualizationDocumentState } from "../session/visualizationDocumentState";

suite("visualization document state (#67)", () => {
  test("tracks explicit draft, save, and revert transitions", () => {
    const state = new VisualizationDocumentState({ viewport: { zoom: 2 } });
    assert.equal(state.dirty, false);

    state.update({ viewport: { zoom: 5 } });
    assert.equal(state.dirty, true);
    assert.equal(state.draft.viewport.zoom, 5);

    state.revert();
    assert.equal(state.dirty, false);
    assert.equal(state.draft.viewport.zoom, 2);

    state.update({ viewport: { zoom: 7 } });
    state.commit();
    assert.equal(state.dirty, false);
    assert.equal(state.committed.viewport.zoom, 7);
  });

  test("returns clones so callers cannot mutate host-owned state", () => {
    const state = new VisualizationDocumentState({ values: [1, 2] });
    state.draft.values.push(3);
    assert.deepEqual(state.draft.values, [1, 2]);
  });
});
