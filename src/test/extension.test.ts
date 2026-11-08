import * as assert from "node:assert/strict";
import * as os from "node:os";
import * as vscode from "vscode";
import {
  graphForgeVizShowOptions,
  trackVizPanel,
} from "../webview/panelColumn";

/**
 * Full public command surface for this branch (mirrors
 * `package.json#contributes.commands` plus programmatic-only paging). This is
 * the contract a coding agent (Cursor agent, Copilot-style agent, etc.) can rely on: every one of these
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
  "graphforge.openSampleProject",
  "graphforge.cloneFromHub",
  "graphforge.publishToHub",
  "graphforge.openSampleNotebook",
  "graphforge.openSampleStreamlit",
  "graphforge.closeProject",
  "graphforge.refreshExplorer",
  "graphforge.runQuery",
  "graphforge.readResultPage",
  "graphforge.runQueryWithParams",
  "graphforge.runProjectQuery",
  "graphforge.saveProjectQuery",
  "graphforge.saveProjectQueryTemplate",
  "graphforge.openProjectResult",
  "graphforge.openProjectVisualization",
  "graphforge.saveProjectVisualization",
  "graphforge.createProjectVisualization",
  "graphforge.openProjectArtifact",
  "graphforge.applyProjectMutation",
  "graphforge.agent.getContext",
  "graphforge.agent.listArtifacts",
  "graphforge.showResultsTable",
  "graphforge.checkEnvironment",
  "graphforge.copyEnvironmentReport",
  "graphforge.getStarted",
  "graphforge.getStarted.showHome",
  "graphforge.getStarted.showQuery",
  "graphforge.getStarted.showVisualize",
  "graphforge.openSettings",
  "graphforge.manageModules",
  "graphforge.installModuleFromFile",
  "graphforge.refreshModules",
  "graphforge.importData",
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
    assert.ok(
      ext.packageJSON.activationEvents.includes("onUri"),
      "Hub links must activate the extension before its URI handler is registered",
    );
    await ext.activate();
    assert.equal(ext.isActive, true);

    const commands = await vscode.commands.getCommands(true);
    for (const id of ALL_COMMAND_IDS) {
      assert.ok(commands.includes(id), `missing command ${id}`);
    }
    assert.ok(
      commands.includes("graphforge.getStarted.showHub"),
      "the pre-ADR-0005 Show Hub alias must stay callable",
    );
    const modules = await vscode.commands.executeCommand<
      Array<{ id: string; source: string; installed: boolean; removable: boolean }>
    >("graphforge.refreshModules");
    const defaults = modules?.filter((module) => module.source === "first-party");
    assert.deepEqual(defaults.map((module) => module.id), [
      "graphforge.import",
      "graphforge.query",
      "graphforge.visualize",
    ]);
    for (const module of defaults ?? []) {
      assert.equal(module.installed, true, `${module.id} must ship installed`);
      assert.equal(module.removable, false, `${module.id} must not be removable`);
    }
  });

  test("cypher language is registered", async () => {
    const languages = await vscode.languages.getLanguages();
    assert.ok(languages.includes("cypher"), "cypher language missing");
  });

  test("rapid visualization opens use the live panel column, not stale Active", () => {
    let disposePanel: (() => void) | undefined;
    let revealCalls = 0;
    const disposable: vscode.Disposable = { dispose() {} };
    const panel = {
      viewColumn: vscode.ViewColumn.Two,
      viewType: "graphforge.resultGraph",
      active: false,
      visible: true,
      reveal() {
        revealCalls += 1;
      },
      onDidChangeViewState() {
        return disposable;
      },
      onDidDispose(listener: () => void) {
        disposePanel = listener;
        return disposable;
      },
    } as unknown as vscode.WebviewPanel;

    trackVizPanel(panel);
    const options = graphForgeVizShowOptions();
    disposePanel?.();

    assert.equal(
      options.viewColumn,
      vscode.ViewColumn.Two,
      "a back-to-back open must target the anchor's group before Active settles",
    );
    assert.equal(
      revealCalls,
      0,
      "column selection must not depend on asynchronous focus from reveal()",
    );
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
  test("agent.getContext returns a versioned, UI-free discovery contract", async () => {
    const context = await vscode.commands.executeCommand<{
      format: string;
      environment: { project: { open: boolean } };
      discoveredProjects: Array<{ name: string; path: string }>;
      project?: unknown;
      settings: Record<string, unknown>;
      commands: Array<{ id: string; args: string; returns: string }>;
      contracts: Record<string, string>;
    }>("graphforge.agent.getContext");

    assert.ok(context);
    assert.equal(context.format, "graphforge.agent-context/v1");
    assert.equal(context.environment.project.open, false);
    assert.ok(Array.isArray(context.discoveredProjects));
    assert.equal(typeof context.settings.runtime, "string");
    assert.ok(
      context.commands.some((command) => command.id === "graphforge.runProjectQuery"),
    );
    assert.ok(
      context.commands.some((command) => command.id === "graphforge.openSampleNotebook"),
    );
    assert.ok(
      context.commands.some((command) => command.id === "graphforge.openSampleStreamlit"),
    );
    for (const field of ["resultId", "columns", "rows", "rowCount", "offset", "nextOffset"]) {
      assert.ok(context.contracts.result.includes(field), `result discovery must describe ${field}`);
    }
    const paging = context.commands.find(command => command.id === "graphforge.readResultPage");
    assert.ok(paging, "discovery must expose result continuation");
    assert.match(paging.args, /resultId/);
  });

  test("agent.listArtifacts fails closed when no project is open or specified", async () => {
    const result = await vscode.commands.executeCommand<{
      error?: string;
      code?: string;
      nextAction?: string;
    }>("graphforge.agent.listArtifacts");

    assert.equal(result?.code, "PROJECT_REQUIRED");
    assert.match(result?.nextAction ?? "", /openProject/);
  });

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
    // CI has no peer install; local monorepos may resolve a sibling binding.
    // Either way the report must be structured and fail closed (no throw).
    assert.equal(report.project.open, false);
    assert.ok(report.nextAction.length > 0, "nextAction must be actionable");
    if (!report.nodeBinding.available && !report.python.available) {
      assert.equal(report.runtime.active, "none");
      assert.match(
        report.nextAction,
        /Setup Native Binding/,
        "nextAction should point at Setup Native Binding when neither runtime is usable",
      );
    } else {
      // Sibling peer / local Python may be available in monorepo hosts.
      assert.match(
        report.nextAction,
        /Open Project|Initialize|Open Sample|ready|Run Query|sample/i,
        `nextAction should name a project/query next step when a runtime is usable — got ${report.nextAction}`,
      );
    }
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

  test("showResultsTable reopens the bottom panel without a result", async () => {
    await assert.doesNotReject(
      Promise.resolve(vscode.commands.executeCommand("graphforge.showResultsTable")),
    );
  });

  test("showResultGraph does not throw (reports a missing result without fabricating a demo)", async () => {
    await assert.doesNotReject(
      Promise.resolve(vscode.commands.executeCommand("graphforge.showResultGraph")),
    );
  });

  test("XYG commands fail clearly when no real result exists", async () => {
    for (const command of ["graphforge.showResultGraph","graphforge.showFigure","graphforge.figureFromResult"]) {
      const outcome=await vscode.commands.executeCommand<{error?:string}>(command);
      assert.ok(outcome?.error);
    }
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

  test("manageModules opens the module manager webview without prompting", async () => {
    await assert.doesNotReject(
      Promise.resolve(vscode.commands.executeCommand("graphforge.manageModules")),
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
  ["graphforge.applyProjectMutation", { path: "mutations/ci.cypher", confirm: true }],
  ["graphforge.importData", { path: "/tmp/ci.csv", label: "Ci", confirm: true }],
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
  // Clone needs no open project. With bundled Core a valid request reaches the
  // network and OS credential store, even for a nonexistent repository. Keep
  // its offline failure coverage in the argument-validation suite below; real
  // clone behavior belongs to the opt-in installed Hub qualification runner.
  // Publish to Hub (#91) — agent calls never prompt and none of these can reach
  // Core: no binding ⇒ CLI_UNAVAILABLE; no `gf publish` ⇒ PUBLISH_UNSUPPORTED;
  // no project ⇒ HUB_PUBLISH_PROJECT_REQUIRED; no confirm ⇒ CONFIRMATION_REQUIRED;
  // previews ⇒ HUB_PUBLISH_PREVIEWS_UNAVAILABLE (xyg#935).
  ["graphforge.publishToHub", { repository: "opendata/openalex", ref: "main" }],
  [
    "graphforge.publishToHub",
    {
      repository: "opendata/openalex",
      ref: "main",
      previews: ["chart.png", "chart.svg"],
      confirm: true,
    },
  ],
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
        exitCode?: number;
        args?: string[];
      }>(commandId, args);

      assert.ok(
        result !== undefined && result !== null && typeof result === "object",
        `${commandId} resolved ${String(result)} — expected a structured object`,
      );
      // Local monorepos may load a sibling CLI/binding; runCli then returns a
      // structured RunCliResult instead of CLI_UNAVAILABLE.
      if (commandId === "graphforge.runCli" && typeof result.exitCode === "number") {
        assert.ok(Array.isArray(result.args));
        return;
      }
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

suite("Hub clone agent argument validation", () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension("CurateLabsAI.graphforge")!.activate();
  });

  for (const [label, args, code] of [
    ["missing destination", { repository: "opendata/openalex" }, "HUB_CLONE_DESTINATION_REQUIRED"],
    ["empty arguments", {}, "HUB_REPOSITORY_INVALID"],
    ["empty destination", { repository: "opendata/openalex", destination: "" }, "HUB_CLONE_DESTINATION_REQUIRED"],
    ["null arguments", null, "HUB_CLONE_ARGUMENTS_INVALID"],
    ["string arguments", "opendata/openalex", "HUB_CLONE_ARGUMENTS_INVALID"],
    ["number arguments", 42, "HUB_CLONE_ARGUMENTS_INVALID"],
    ["array arguments", [], "HUB_CLONE_ARGUMENTS_INVALID"],
    ["mistyped repository", { repository: 42 }, "HUB_CLONE_ARGUMENTS_INVALID"],
    ["mistyped destination", { destination: false }, "HUB_CLONE_ARGUMENTS_INVALID"],
    ["mistyped ref", { ref: [] }, "HUB_CLONE_ARGUMENTS_INVALID"],
    ["mistyped version UUID", { versionUuid: null }, "HUB_CLONE_ARGUMENTS_INVALID"],
    ["mistyped open", { open: "true" }, "HUB_CLONE_ARGUMENTS_INVALID"],
  ] as const) {
    test(`rejects ${label} without prompts or a native binding`, async function () {
      this.timeout(5_000);
      const result = await vscode.commands.executeCommand<{
        error: string;
        code: string;
        nextAction: string;
      }>("graphforge.cloneFromHub", args);
      assert.equal(result?.code, code);
      assert.equal(typeof result.error, "string");
      assert.ok(result.nextAction.length > 0);
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
