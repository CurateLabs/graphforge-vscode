import * as assert from "node:assert/strict";
import { EXPERIENCE_MODE_CARDS } from "../session/experienceMode";
import {
  buildChecklistSteps,
  buildWorkspaceModel,
  renderModeCardsHtml,
  runtimeStepActions,
} from "../views/getStartedContent";

suite("getStartedContent", () => {
  suite("buildChecklistSteps (#63)", () => {
    const base = {
      runtimeReady: true,
      projectReady: true,
      hasLastResult: false,
      isSampleProject: true,
      projectName: "graphforge-quickstart",
      projectPath: "/tmp/graphforge-quickstart",
      activeRuntime: "node" as const,
      nodeLine: "Node binding ready",
      pythonLine: "Python runtime not configured",
      projectKind: "node" as const,
      seenResultGraph: false,
      seenFigure: false,
      sampleQueryPath: "queries/templates/routes-overview.cypher",
      sampleFigurePath: "visualizations/route-distances.gfviz.json",
    };

    test("Try sample is project secondary when runtime ready and no project", () => {
      const steps = buildChecklistSteps({
        ...base,
        projectReady: false,
        isSampleProject: false,
      });
      const project = steps.find((s) => s.id === "project");
      assert.equal(project?.status, "current");
      assert.equal(project?.secondaryAction?.command, "graphforge.openSampleProject");
      assert.equal(project?.secondaryAction?.label, "Try sample project");
    });

    test("Try sample stays visible before runtime setup", () => {
      const steps = buildChecklistSteps({
        ...base,
        runtimeReady: false,
        projectReady: false,
        isSampleProject: false,
      });
      const project = steps.find((s) => s.id === "project");
      assert.equal(project?.status, "pending");
      assert.equal(project?.secondaryAction?.command, "graphforge.openSampleProject");
    });

    test("query step done on hasLastResult; see-results becomes current", () => {
      const steps = buildChecklistSteps({ ...base, hasLastResult: true });
      assert.equal(steps.find((s) => s.id === "query")?.status, "done");
      const see = steps.find((s) => s.id === "see-results");
      assert.equal(see?.status, "current");
      assert.equal(see?.primaryAction?.command, "graphforge.showResultGraph");
      assert.equal(see?.secondaryAction?.command, "graphforge.openProjectVisualization");
      assert.deepEqual(see?.secondaryAction?.args, [
        { path: "visualizations/route-distances.gfviz.json" },
      ]);
    });

    test("sample query CTA runs the project query by path", () => {
      const steps = buildChecklistSteps(base);
      const query = steps.find((s) => s.id === "query");
      assert.equal(query?.status, "current");
      assert.equal(query?.primaryAction?.command, "graphforge.runProjectQuery");
      assert.deepEqual(query?.primaryAction?.args, [
        { path: "queries/templates/routes-overview.cypher" },
      ]);
    });

    test("see-results done when both viz surfaces have been shown", () => {
      const steps = buildChecklistSteps({
        ...base,
        hasLastResult: true,
        seenResultGraph: true,
        seenFigure: true,
      });
      assert.equal(steps.find((s) => s.id === "see-results")?.status, "done");
    });
  });

  suite("buildWorkspaceModel", () => {
    test("guided onboarding prominently offers the starter space without a runtime", () => {
      const workspace = buildWorkspaceModel({
        runtimeReady: false,
        projectReady: false,
        hasLastResult: false,
        isSampleProject: false,
      });
      assert.equal(workspace.layout, "guided");
      assert.equal(workspace.starter.title, "Starter space");
      assert.match(workspace.starter.detail, /after choosing a Node or Python runtime/);
      assert.equal(
        workspace.starter.actions[0]?.command,
        "graphforge.openSampleProject",
      );
      assert.equal(workspace.starter.actions[0]?.label, "Try sample project");
    });

    test("first result switches to a persistent control hub", () => {
      const workspace = buildWorkspaceModel({
        runtimeReady: true,
        projectReady: true,
        hasLastResult: true,
        isSampleProject: true,
        projectName: "graphforge-quickstart",
      });
      assert.equal(workspace.layout, "hub");
      const commands = workspace.controls.flatMap((control) =>
        control.actions.map((action) => action.command),
      );
      for (const command of [
        "graphforge.openProject",
        "graphforge.openSampleProject",
        "graphforge.runQuery",
        "graphforge.showResultsTable",
        "graphforge.showResultGraph",
        "graphforge.figureFromResult",
        "graphforge.find",
        "graphforge.showOntology",
      ]) {
        assert.ok(commands.includes(command), `missing hub command ${command}`);
      }
      const figure = workspace.controls
        .flatMap((control) => control.actions)
        .find((action) => action.command === "graphforge.figureFromResult");
      assert.equal(figure?.args, undefined);
    });
  });

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
