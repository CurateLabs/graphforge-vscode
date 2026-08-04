import * as assert from "node:assert/strict";
import {
  buildChecklistSteps,
  runtimeStepActions,
  selectJourneyArtifacts,
} from "../views/getStartedContent";

suite("getStartedContent", () => {
  const base = {
    runtimeReady: true,
    projectReady: true,
    hasLastResult: false,
    hasResultArtifact: false,
    hasSavedVisualization: false,
    isSampleProject: true,
    projectName: "graphforge-quickstart",
    activeRuntime: "node" as const,
    nodeLine: "Node binding ready",
    pythonLine: "Python is optional for scripts and notebooks",
    projectKind: "node" as const,
    sampleQueryPath: "queries/templates/routes-overview.cypher",
  };

  test("keeps one five-node journey visible in dependency order", () => {
    const steps = buildChecklistSteps(base);
    assert.deepEqual(
      steps.map((step) => step.id),
      ["environment", "project", "query", "result", "visualize"],
    );
    assert.deepEqual(
      steps.map((step) => step.status),
      ["done", "done", "current", "pending", "pending"],
    );
  });

  test("offers the sample only at the current project node", () => {
    const steps = buildChecklistSteps({
      ...base,
      projectReady: false,
      isSampleProject: false,
    });
    const project = steps.find((step) => step.id === "project");
    assert.equal(project?.status, "current");
    assert.equal(project?.primaryAction?.command, "graphforge.openProject");
    assert.equal(project?.secondaryAction?.command, "graphforge.openSampleProject");
    assert.equal(project?.secondaryAction?.label, "Try the air-routes sample");
  });

  test("runs the sample's real project-owned query path", () => {
    const query = buildChecklistSteps(base).find((step) => step.id === "query");
    assert.equal(query?.primaryAction?.command, "graphforge.runProjectQuery");
    assert.deepEqual(query?.primaryAction?.args, [
      { path: "queries/templates/routes-overview.cypher" },
    ]);
    assert.equal(query?.secondaryAction?.label, "Open Python notebook");
    assert.equal(query?.secondaryAction?.command, "graphforge.openSampleNotebook");
    assert.equal(query?.tertiaryAction?.label, "Open Streamlit app");
    assert.equal(query?.tertiaryAction?.command, "graphforge.openSampleStreamlit");
    assert.equal(query?.artifact, "queries/templates/routes-overview.cypher");
  });

  test("routes custom projects into the embedded query workspace", () => {
    const query = buildChecklistSteps({
      ...base,
      isSampleProject: false,
      sampleQueryPath: undefined,
    }).find((step) => step.id === "query");
    assert.equal(query?.primaryAction?.label, "Write and run query");
    assert.equal(query?.primaryAction?.command, "graphforge.getStarted.showQuery");
    assert.equal(query?.secondaryAction, undefined);
    assert.equal(query?.tertiaryAction, undefined);
    assert.equal(query?.artifact, "queries/first-query.cypher");
  });

  test("uses saved result and visualization artifacts as progress evidence", () => {
    const steps = buildChecklistSteps({
      ...base,
      hasResultArtifact: true,
      hasSavedVisualization: true,
      resultPath: "results/routes-overview.json",
      visualizationPath: "visualizations/airports-map.gfviz.json",
    });
    assert.deepEqual(steps.map((step) => step.status), ["done", "done", "done", "done", "done"]);
    const result = steps.find((step) => step.id === "result");
    const visualization = steps.find((step) => step.id === "visualize");
    assert.equal(result?.artifact, "results/routes-overview.json");
    assert.equal(visualization?.artifact, "visualizations/airports-map.gfviz.json");
    assert.equal(
      visualization?.primaryAction?.command,
      "graphforge.openProjectVisualization",
    );
    assert.deepEqual(visualization?.primaryAction?.args, [
      {
        path: "visualizations/airports-map.gfviz.json",
        waitForReady: true,
        timeoutMs: 60_000,
      },
    ]);
  });

  test("opens a durable result before asking for a visualization", () => {
    const steps = buildChecklistSteps({
      ...base,
      hasResultArtifact: true,
      resultPath: "results/routes-overview.json",
    });
    const result = steps.find((step) => step.id === "result");
    const visualization = steps.find((step) => step.id === "visualize");
    assert.equal(result?.status, "current");
    assert.equal(result?.primaryAction?.command, "graphforge.openProjectResult");
    assert.deepEqual(result?.primaryAction?.args, [
      { path: "results/routes-overview.json" },
    ]);
    assert.equal(visualization?.status, "pending");
  });

  test("does not advertise a quickstart visualization before its query result exists", () => {
    const beforeQuery = selectJourneyArtifacts(
      true,
      [{ path: "results/route-activity.json" }],
      [
        {
          path: "visualizations/airports-map.gfviz.json",
          result: "results/query-result.json",
          kind: "geospatial",
          format: "graphforge.visualization/v2",
          renderer: "l7",
        },
        {
          path: "visualizations/route-activity-timeline.gfviz.json",
          result: "results/route-activity.json",
          kind: "temporal",
          format: "graphforge.visualization/v2",
          renderer: "g2",
        },
      ],
    );
    assert.deepEqual(beforeQuery, {
      resultPath: undefined,
      visualizationPath: undefined,
    });

    const afterQuery = selectJourneyArtifacts(
      true,
      [
        { path: "results/query-result.json" },
        { path: "results/route-activity.json" },
      ],
      [
        {
          path: "visualizations/airports-map.gfviz.json",
          result: "results/query-result.json",
          kind: "geospatial",
          format: "graphforge.visualization/v2",
          renderer: "l7",
        },
        {
          path: "visualizations/routes-network-default.gfviz.json",
          result: "results/query-result.json",
          kind: "result-graph",
          format: "graphforge.visualization/v2",
          renderer: "cytoscape",
        },
        {
          path: "visualizations/routes-network-antv.gfviz.json",
          result: "results/query-result.json",
          kind: "result-graph",
          format: "graphforge.visualization/v2",
          renderer: "g6",
        },
        {
          path: "visualizations/routes-network.gfviz.json",
          result: "results/query-result.json",
          kind: "result-graph",
          format: "graphforge.visualization/v1",
          renderer: "cytoscape",
        },
      ],
    );
    assert.deepEqual(afterQuery, {
      resultPath: "results/query-result.json",
      visualizationPath: "visualizations/airports-map.gfviz.json",
    });
  });

  suite("runtimeStepActions", () => {
    test("a ready runtime has no setup action", () => {
      assert.deepEqual(runtimeStepActions(true, "python"), {});
    });

    test("Python-first workspaces lead with Python setup", () => {
      const actions = runtimeStepActions(false, "python");
      assert.equal(actions.primaryAction?.command, "graphforge.setupPythonBinding");
      assert.equal(actions.secondaryAction?.command, "graphforge.checkEnvironment");
    });

    test("Node-ish and ambiguous workspaces lead with Node setup", () => {
      for (const kind of ["node", "ambiguous"] as const) {
        const actions = runtimeStepActions(false, kind);
        assert.equal(actions.primaryAction?.command, "graphforge.setupNativeBinding");
        assert.equal(actions.secondaryAction?.command, "graphforge.checkEnvironment");
      }
    });
  });
});
