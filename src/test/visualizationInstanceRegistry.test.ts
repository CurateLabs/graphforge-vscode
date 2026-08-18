import * as assert from "node:assert/strict";
import { VisualizationInstanceLifecycle, VisualizationInstanceRegistry, visualizationInstanceId, type VisualizationController, type VisualizationKind } from "../webview/visualizationInstanceRegistry";

function controller(instanceId: string, kind: VisualizationKind, coordinationGroup?: string): VisualizationController & { disposed: boolean } {
  return { instanceId, kind, coordinationGroup, renderGeneration: 1, disposed: false, reveal() {}, dispose() { this.disposed = true; } };
}

suite("visualization instance registry (#81)", () => {
  test("keeps multiple visualization kinds independent", () => {
    const registry = new VisualizationInstanceRegistry();
    const graph = registry.register(controller("graph:a", "graph"));
    const map = registry.register(controller("geospatial:b", "geospatial"));
    assert.equal(registry.get("graph:a"), graph);
    assert.equal(registry.get("geospatial:b"), map);
    assert.equal(registry.values().length, 2);
  });
  test("activation and removal never replace another instance", () => {
    const registry = new VisualizationInstanceRegistry();
    const first = registry.register(controller("graph:a", "graph"));
    const second = registry.register(controller("graph:b", "graph"));
    assert.equal(registry.active("graph"), second);
    registry.activate(first.instanceId);
    assert.equal(registry.active("graph"), first);
    registry.remove(first.instanceId);
    assert.equal(registry.active("graph"), second);
  });
  test("coordination is explicit and disposal is deterministic", () => {
    const registry = new VisualizationInstanceRegistry();
    const graph = registry.register(controller("graph:a", "graph", "analysis:1"));
    const timeline = registry.register(controller("temporal:b", "temporal", "analysis:1"));
    registry.register(controller("chart:c", "chart"));
    assert.deepEqual(registry.coordinated("analysis:1"), [graph, timeline]);
    registry.dispose();
    assert.equal(graph.disposed, true);
    assert.equal(timeline.disposed, true);
  });
  test("saved identities are stable and private; unsaved identities are unique", () => {
    const saved = visualizationInstanceId("graph", "/secret/project", "visualizations/a.json");
    assert.equal(saved, visualizationInstanceId("graph", "/secret/project", "visualizations/a.json"));
    assert.notEqual(visualizationInstanceId("graph"), visualizationInstanceId("graph"));
    assert.doesNotMatch(saved, /secret|visualizations/);
  });
  test("cancels superseded work and rejects late generations", () => {
    const lifecycle = new VisualizationInstanceLifecycle("graph:a");
    const first = lifecycle.beginRender();
    const second = lifecycle.beginRender();
    assert.equal(first.signal.aborted, true);
    assert.equal(second.signal.aborted, false);
    assert.equal(lifecycle.accepts(first.context), false);
    assert.equal(lifecycle.accepts(second.context), true);
    lifecycle.dispose();
    assert.equal(second.signal.aborted, true);
    assert.equal(lifecycle.accepts(second.context), false);
  });
  test("routes coordination only to an explicit group and rejects stale sources", () => {
    const registry = new VisualizationInstanceRegistry();
    registry.register(controller("graph:a", "graph", "analysis:1"));
    registry.register(controller("temporal:b", "temporal", "analysis:1"));
    registry.register(controller("chart:c", "chart"));
    const received: unknown[] = [];
    registry.subscribeCoordination("temporal:b", (event) => received.push(event.payload));
    registry.publishCoordination({
      group: "analysis:1", sourceInstanceId: "graph:a", instanceId: "graph:a",
      renderGeneration: 1, type: "selection", payload: { ids: ["n1"] },
    });
    registry.publishCoordination({
      group: "analysis:1", sourceInstanceId: "graph:a", instanceId: "graph:a",
      renderGeneration: 0, type: "selection", payload: { ids: ["stale"] },
    });
    assert.deepEqual(received, [{ ids: ["n1"] }]);
  });
});
