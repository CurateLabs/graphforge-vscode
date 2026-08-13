import * as assert from "node:assert/strict";
import { visualizationLoadingState } from "../webview/visualizationLoadingModel";

suite("visualization loading model", () => {
  test("names truthful renderer-specific graph stages", () => {
    const g6 = visualizationLoadingState({
      renderer: "g6",
      phase: "layout",
      nodeCount: 579,
      edgeCount: 7_430,
    });
    assert.equal(g6.rendererName, "AntV G6");
    assert.equal(g6.title, "Running ForceAtlas2 layout");
    assert.equal(g6.detail, "579 nodes · 7,430 edges");
    assert.deepEqual(g6.steps.map((step) => step.state), ["complete", "current", "pending"]);

    const cytoscape = visualizationLoadingState({ renderer: "cytoscape", phase: "layout" });
    assert.equal(cytoscape.title, "Running CoSE layout");
    assert.equal(cytoscape.steps[1]?.label, "CoSE layout");

    const sigma = visualizationLoadingState({ renderer: "sigma", phase: "paint" });
    assert.equal(sigma.title, "Painting with WebGL");
    assert.equal(sigma.steps[2]?.label, "Paint WebGL");
  });

  test("names chart and map pipelines without invented progress percentages", () => {
    const chart = visualizationLoadingState({ renderer: "g2", phase: "layout", rowCount: 7_430 });
    assert.equal(chart.title, "Composing marks and scales");
    assert.equal(chart.detail, "7,430 result rows");
    assert.ok(!JSON.stringify(chart).includes("%"));

    const map = visualizationLoadingState({ renderer: "l7", phase: "paint", rowCount: 12 });
    assert.equal(map.title, "Painting map layers");
    assert.deepEqual(map.steps.map((step) => step.state), ["complete", "complete", "current"]);
  });

  test("keeps failure at the stage that actually failed", () => {
    const failed = visualizationLoadingState({
      renderer: "g6",
      phase: "failed",
      failedAt: "paint",
      message: "Canvas did not paint visible pixels.",
    });
    assert.equal(failed.title, "AntV G6 stopped");
    assert.equal(failed.detail, "Canvas did not paint visible pixels.");
    assert.deepEqual(failed.steps.map((step) => step.state), ["complete", "complete", "failed"]);
  });
});
