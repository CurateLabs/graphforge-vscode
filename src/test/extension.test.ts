import * as assert from "node:assert/strict";
import * as os from "node:os";
import * as vscode from "vscode";

/**
 * Full public command surface for this branch (mirrors
 * `package.json#contributes.commands`). This is the contract a coding agent
 * (Cursor agent, Copilot-style agent, etc.) can rely on: every one of these
 * IDs must be registered after activation, callable via
 * `vscode.commands.executeCommand("graphforge.<id>", ...)` without going
 * through the Command Palette UI.
 *
 * See `docs/experience/agent-interop.md` for the full agent-facing contract
 * (which commands accept args vs. require QuickPick, structured return
 * shapes, and the recommended Check Environment → Setup/Init → Run
 * Query/Rank loop).
 */
const ALL_COMMAND_IDS = [
  "graphforge.openProject",
  "graphforge.refreshExplorer",
  "graphforge.runQuery",
  "graphforge.runQueryWithParams",
  "graphforge.checkEnvironment",
  "graphforge.copyEnvironmentReport",
  "graphforge.getStarted",
  "graphforge.chooseExperienceMode",
  "graphforge.openSettings",
  "graphforge.setupNativeBinding",
  "graphforge.setupPythonBinding",
  "graphforge.initializeProjectHere",
  "graphforge.rank",
  "graphforge.rankAdvanced",
  "graphforge.cluster",
  "graphforge.clusterAdvanced",
  "graphforge.paths",
  "graphforge.pathsAdvanced",
  "graphforge.analyze",
  "graphforge.analyzeAdvanced",
  "graphforge.similar",
  "graphforge.similarAdvanced",
  "graphforge.find",
  "graphforge.indexText",
  "graphforge.indexVector",
  "graphforge.inspectTextIndex",
  "graphforge.indexAdjacency",
  "graphforge.inspectAdjacency",
  "graphforge.rebuildAdjacency",
  "graphforge.createCheckpoint",
  "graphforge.listCheckpoints",
  "graphforge.openCheckpoint",
  "graphforge.diffCheckpoints",
  "graphforge.deleteCheckpoint",
  "graphforge.revertToCheckpoint",
  "graphforge.embeddingSpaces",
  "graphforge.publishCallerEmbeddings",
  "graphforge.bindEmbeddingSpaceAlias",
  "graphforge.setDefaultEmbeddingSpace",
  "graphforge.deleteEmbeddingSpace",
  "graphforge.inspectEmbeddingSpaceFreshness",
  "graphforge.enableCapability",
  "graphforge.openWithWriteMode",
  "graphforge.exportInvocationDescriptor",
  "graphforge.listAlgorithmRuns",
  "graphforge.publishCompositeTransaction",
  "graphforge.runCli",
  "graphforge.showOntology",
  "graphforge.showResultGraph",
  "graphforge.showResultGraphAdvanced",
  "graphforge.showFigure",
  "graphforge.figureFromResult",
  "graphforge.statusBarClick",
  "graphforge.showCapabilities",
  "graphforge.loadOntology",
  "graphforge.openOntologyFile",
  "graphforge.explainOntologyMode",
  "graphforge.listAssertions",
  "graphforge.createAssertion",
  "graphforge.showAssertion",
  "graphforge.showAssertionOnGraph",
  "graphforge.attachEvidence",
  "graphforge.assessConfidence",
  "graphforge.recordAssertionStatus",
];

suite("GraphForge extension", () => {
  test("activates and registers all agent-facing command IDs", async () => {
    const ext = vscode.extensions.getExtension("CurateLabsAI.graphforge");
    assert.ok(ext, "extension CurateLabsAI.graphforge not found");
    await ext.activate();
    assert.equal(ext.isActive, true);

    const commands = await vscode.commands.getCommands(true);
    for (const id of ALL_COMMAND_IDS) {
      assert.ok(commands.includes(id), `missing command ${id}`);
    }
  });

  test("cypher language is registered", async () => {
    const languages = await vscode.languages.getLanguages();
    assert.ok(languages.includes("cypher"), "cypher language missing");
  });
});

/**
 * Agent interop: commands that are safe to *execute* (not just check for
 * registration) in a headless CI run with no `@curatelabs/graphforge` binding
 * installed and no GraphForge project open. "Safe" here specifically means:
 * no `showQuickPick`/`showInputBox`/awaited `showErrorMessage(..., items)`
 * call anywhere on the code path, since those block on human interaction
 * that will never come in CI and would hang the test run.
 *
 * Everything NOT in this suite (see the "skipped" comment block below) needs
 * either a live project + native binding, or walks through an interactive
 * QuickPick/InputBox chain, and is intentionally only smoke-tested for
 * registration above.
 */
suite("GraphForge agent interop — safe commands (no binding, no project)", () => {
  test("checkEnvironment does not throw and returns a structured EnvironmentReport", async () => {
    const report = await vscode.commands.executeCommand<{
      runtime: { preference: string; active: string };
      nodeBinding: { available: boolean; error?: string };
      python: { available: boolean };
      project: { open: boolean; path?: string; name?: string };
      nextAction: string;
      timestamp: string;
    }>("graphforge.checkEnvironment");

    assert.ok(report, "checkEnvironment returned nothing");
    assert.equal(typeof report.nodeBinding.available, "boolean");
    assert.equal(typeof report.python.available, "boolean");
    assert.equal(typeof report.project.open, "boolean");
    // No @curatelabs/graphforge in devDependencies/peerDependencies is installed
    // for this test run, so the Node binding must fail closed rather than
    // throw, and no project is open yet.
    assert.equal(report.nodeBinding.available, false);
    assert.equal(report.project.open, false);
    assert.equal(report.runtime.active, "none");
    assert.ok(report.nextAction.length > 0, "nextAction must be actionable");
    assert.match(
      report.nextAction,
      /Setup Native Binding/,
      "nextAction should point an agent at Setup Native Binding when neither runtime is usable",
    );
    assert.ok(!Number.isNaN(Date.parse(report.timestamp)), "timestamp must be ISO-parsable");
  });

  test("checkEnvironment with { silent: true } still returns the report (no editor/toast side effects)", async () => {
    const report = await vscode.commands.executeCommand<{ nodeBinding: { available: boolean } }>(
      "graphforge.checkEnvironment",
      { silent: true },
    );
    assert.ok(report);
    assert.equal(typeof report.nodeBinding.available, "boolean");
  });

  test("copyEnvironmentReport puts the environment JSON on the clipboard and returns the report (#32)", async () => {
    const report = await vscode.commands.executeCommand<{
      nodeBinding: { available: boolean };
      nextAction: string;
    }>("graphforge.copyEnvironmentReport");

    assert.ok(report, "copyEnvironmentReport returned nothing");
    assert.equal(typeof report.nodeBinding.available, "boolean");
    assert.ok(report.nextAction.length > 0);

    const clipboard = await vscode.env.clipboard.readText();
    const parsed = JSON.parse(clipboard) as { nextAction?: string };
    assert.equal(
      parsed.nextAction,
      report.nextAction,
      "clipboard must contain the same curated report the command returned",
    );
  });

  test("openProject with a non-GraphForge path arg fails closed without throwing or prompting", async () => {
    // Passing a `pathArg` (a plain temp dir with no FORMAT marker) takes the
    // args branch and skips the folder-picker dialog entirely — this is the
    // "no cascading menus required" contract for commands that accept args.
    await assert.doesNotReject(
      Promise.resolve(vscode.commands.executeCommand("graphforge.openProject", os.tmpdir())),
    );
  });

  test("refreshExplorer does not throw", async () => {
    await assert.doesNotReject(
      Promise.resolve(vscode.commands.executeCommand("graphforge.refreshExplorer")),
    );
  });

  test("showResultGraph does not throw (opens demo graph webview when no result exists yet)", async () => {
    await assert.doesNotReject(
      Promise.resolve(vscode.commands.executeCommand("graphforge.showResultGraph")),
    );
  });

  test("showFigure with { figure } returns structured panel status without prompting (#62)", async () => {
    const result = await vscode.commands.executeCommand<{
      figure?: { data: unknown[] };
      panel?: string;
      error?: string;
      code?: string;
    }>("graphforge.showFigure", {
      figure: {
        data: [{ type: "bar", x: ["a", "b"], y: [1, 2] }],
        layout: { title: { text: "agent figure" } },
      },
    });
    assert.ok(result);
    assert.equal(result.error, undefined);
    assert.ok(result.figure?.data?.length);
    assert.ok(result.panel === "opened" || result.panel === "updated");
  });

  test("showFigure without figure returns FIGURE_REQUIRED (#62)", async () => {
    const result = await vscode.commands.executeCommand<{
      error?: string;
      code?: string;
      nextAction?: string;
    }>("graphforge.showFigure");
    assert.ok(result);
    assert.equal(result.code, "FIGURE_REQUIRED");
    assert.ok(result.nextAction);
  });

  test("figureFromResult with table + bindings returns figure without prompting (#62)", async () => {
    const result = await vscode.commands.executeCommand<{
      figure?: { data: unknown[] };
      panel?: string;
      chartType?: string;
      error?: string;
    }>("graphforge.figureFromResult", {
      chartType: "bar",
      x: "label",
      y: "score",
      columns: ["label", "score"],
      rows: [
        { label: "a", score: 1 },
        { label: "b", score: 2 },
      ],
    });
    assert.ok(result);
    assert.equal(result.error, undefined);
    assert.equal(result.chartType, "bar");
    assert.ok(result.figure?.data?.length);
    assert.ok(result.panel === "opened" || result.panel === "updated");
  });

  test("showOntology does not throw", async () => {
    await assert.doesNotReject(
      Promise.resolve(vscode.commands.executeCommand("graphforge.showOntology")),
    );
  });

  test("showCapabilities does not throw when no project is open", async () => {
    // ensureProject() rejects (no project); the handler reports via a
    // fire-and-forget showErrorMessage with action buttons and resolves
    // immediately instead of opening the capabilities document.
    await assert.doesNotReject(
      Promise.resolve(vscode.commands.executeCommand("graphforge.showCapabilities")),
    );
  });

  test("getStarted does not throw when no runtime is available", async () => {
    await assert.doesNotReject(
      Promise.resolve(vscode.commands.executeCommand("graphforge.getStarted")),
    );
  });

  test("openSettings opens the Settings webview panel without prompting", async () => {
    await assert.doesNotReject(
      Promise.resolve(vscode.commands.executeCommand("graphforge.openSettings")),
    );
  });

  test("chooseExperienceMode does not throw and does not prompt", async () => {
    await assert.doesNotReject(
      Promise.resolve(vscode.commands.executeCommand("graphforge.chooseExperienceMode")),
    );
  });

  test("statusBarClick opens Get Started when no runtime is available", async () => {
    await assert.doesNotReject(
      Promise.resolve(vscode.commands.executeCommand("graphforge.statusBarClick")),
    );
  });
});

/**
 * Args that let a coding agent drive each command via `executeCommand`
 * without any QuickPick/InputBox — see the command table in
 * `docs/experience/agent-interop.md` (#36). In this suite's environment (no
 * `@curatelabs/graphforge` binding, no project open) every one of these commands
 * must fail closed by *returning* a structured `SetupRecovery`
 * (`{ error, code?, nextAction }`) — never `undefined`, never a bare throw,
 * and never a hang on a prompt nobody will dismiss in CI.
 */
const NO_PROJECT_STRUCTURED_RESULTS: ReadonlyArray<readonly [string, unknown]> = [
  // Cypher (already documented; proves the doc's "missing binding" scenario)
  ["graphforge.runQuery", { cypher: "MATCH (n) RETURN n LIMIT 1" }],
  ["graphforge.runQueryWithParams", { cypher: "MATCH (n) RETURN n LIMIT $k", params: { k: 1 } }],
  // Find (no args-based bypass yet, but its project gate resolves first)
  ["graphforge.find", undefined],
  // Checkpoints (#9)
  ["graphforge.createCheckpoint", { name: "ci-smoke", description: "created by CI" }],
  ["graphforge.listCheckpoints", { limit: 5 }],
  ["graphforge.openCheckpoint", { name: "ci-smoke", cypher: undefined }],
  [
    "graphforge.diffCheckpoints",
    { from: "current", to: "ci-smoke", scope: "summary", detail: "summary" },
  ],
  ["graphforge.deleteCheckpoint", { name: "ci-smoke", confirm: true }],
  ["graphforge.revertToCheckpoint", { name: "ci-smoke", reason: "ci", confirm: true }],
  // Embedding spaces (#10)
  ["graphforge.embeddingSpaces", undefined],
  [
    "graphforge.publishCallerEmbeddings",
    {
      name: "ci-space",
      input: {
        dimensions: 1,
        sourceProjection: { recipe: "ci" },
        rows: [{ node: "00000000-0000-7000-8000-000000000000", vector: [0.1] }],
      },
    },
  ],
  [
    "graphforge.bindEmbeddingSpaceAlias",
    { alias: "ci-alias", compatibilityId: "ci-compat", replace: false },
  ],
  ["graphforge.setDefaultEmbeddingSpace", { clear: true }],
  ["graphforge.deleteEmbeddingSpace", { name: "ci-space", confirm: true }],
  ["graphforge.inspectEmbeddingSpaceFreshness", {}],
  // Index management (#8)
  ["graphforge.indexText", { label: "Person", properties: [], rebuild: false }],
  [
    "graphforge.indexVector",
    { label: "Person", node: "00000000-0000-7000-8000-000000000000", vector: [0.1], space: undefined },
  ],
  ["graphforge.inspectTextIndex", { label: "Person" }],
  ["graphforge.indexAdjacency", undefined],
  ["graphforge.inspectAdjacency", undefined],
  ["graphforge.rebuildAdjacency", undefined],
  // Power (#11)
  ["graphforge.enableCapability", { capabilityId: "ci-capability", version: 1, confirm: true }],
  ["graphforge.openWithWriteMode", { mode: "single_writer", confirm: true }],
  [
    "graphforge.exportInvocationDescriptor",
    { verb: "rank", label: "Person", by: "pagerank", invoke: false },
  ],
  ["graphforge.listAlgorithmRuns", { limit: 5 }],
  [
    "graphforge.publishCompositeTransaction",
    { request: { operationUuid: "", nodes: [], edges: [], knowledge: {} }, confirm: true },
  ],
  // CLI adoption (Part F) — no binding ⇒ CLI unavailable, fails closed with nextAction.
  ["graphforge.runCli", { args: ["status"] }],
  // Knowledge ledger (#13)
  ["graphforge.listAssertions", { limit: 5 }],
  [
    "graphforge.createAssertion",
    {
      claim: "CI smoke assertion",
      subjectUuid: "00000000-0000-7000-8000-000000000000",
      subjectKind: "node",
    },
  ],
  ["graphforge.showAssertion", { assertionUuid: "00000000-0000-7000-8000-000000000000" }],
  ["graphforge.showAssertionOnGraph", { assertionUuid: "00000000-0000-7000-8000-000000000000" }],
  [
    "graphforge.attachEvidence",
    {
      assertionUuid: "00000000-0000-7000-8000-000000000000",
      sourceUuid: "00000000-0000-7000-8000-000000000001",
      sourceKind: "document",
      role: "supports",
    },
  ],
  [
    "graphforge.assessConfidence",
    { assertionUuid: "00000000-0000-7000-8000-000000000000", policy: "explicit", value: 0.5 },
  ],
  [
    "graphforge.recordAssertionStatus",
    {
      assertionUuid: "00000000-0000-7000-8000-000000000000",
      status: "supported",
      provenanceUuid: "00000000-0000-7000-8000-000000000002",
    },
  ],
];

/**
 * Agent interop (#36): every command that needs a live project/binding must
 * *return* its failure — a structured `SetupRecovery` object — instead of
 * resolving `undefined` (the old `void`-and-discard behavior) or hanging on
 * an interactive prompt. Each command here is invoked with the args a real
 * agent would pass (QuickPick/InputBox bypasses, `confirm: true` for
 * destructive commands), which must never open a prompt on this path.
 */
suite("GraphForge agent interop — structured fail-closed results (no binding, no project)", () => {
  for (const [commandId, args] of NO_PROJECT_STRUCTURED_RESULTS) {
    test(`${commandId} returns { error, nextAction } instead of undefined/void`, async () => {
      const result = await vscode.commands.executeCommand<{
        error?: string;
        code?: string;
        nextAction?: string;
      }>(commandId, args);

      assert.ok(
        result !== undefined && result !== null && typeof result === "object",
        `${commandId} resolved ${String(result)} — expected a structured object`,
      );
      assert.equal(
        typeof result.error,
        "string",
        `${commandId} result.error missing — got ${JSON.stringify(result)}`,
      );
      assert.ok(
        typeof result.nextAction === "string" && result.nextAction.length > 0,
        `${commandId} result.nextAction must name the next command — got ${JSON.stringify(result)}`,
      );
    });
  }
});

/**
 * NOT executed here — registration is covered above, but invoking these in
 * a headless test would either hang (they await a `showQuickPick` /
 * `showInputBox` / button-bearing message that nothing will ever dismiss in
 * CI) or do nothing meaningful without a live `@curatelabs/graphforge` binding +
 * an open FORMAT project, neither of which are available in this repo's CI
 * image:
 *
 * - `graphforge.rank` / `rankAdvanced`, `cluster` / `clusterAdvanced`,
 *   `paths` / `pathsAdvanced`, `analyze` / `analyzeAdvanced`, `similar` /
 *   `similarAdvanced` — always walk a QuickPick (label/algorithm) chain
 *   today (no args-based bypass yet — the gap issue #4 owns); their
 *   project gate does return `SetupRecovery` like the commands above, but
 *   they are left registration-only until args land.
 * - `graphforge.setupNativeBinding` / `graphforge.setupPythonBinding` —
 *   show a `showQuickPick` of setup choices.
 * - `graphforge.initializeProjectHere` — awaits a button-bearing
 *   `showErrorMessage` when the binding is unavailable (the common CI case),
 *   then a QuickPick for the target folder.
 * - `graphforge.loadOntology` — requires an open project before it can reach
 *   its (blocking) file picker.
 * - `graphforge.showResultGraphAdvanced` — awaits two QuickPick/InputBox
 *   prompts before doing anything.
 * - `graphforge.openOntologyFile` — awaits a button-bearing
 *   `showInformationMessage` when there is no committed ontology (the CI
 *   case).
 * - `graphforge.explainOntologyMode` — human-display-only (opens a markdown
 *   explainer); safe but asserts nothing an agent relies on.
 *
 * A project-scoped integration test (with a real FORMAT-marked fixture
 * project and `@curatelabs/graphforge` installed) would be needed to exercise the
 * success half of the contract end-to-end; that is out of scope for this
 * activation-time smoke suite.
 */
