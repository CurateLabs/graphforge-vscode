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
  "graphforge.setupNativeBinding",
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
  "graphforge.showOntology",
  "graphforge.showResultGraph",
  "graphforge.showResultGraphAdvanced",
  "graphforge.showCapabilities",
  "graphforge.loadOntology",
];

suite("GraphForge extension", () => {
  test("activates and registers all agent-facing command IDs", async () => {
    const ext = vscode.extensions.getExtension("CurateLabs.graphforge");
    assert.ok(ext, "extension CurateLabs.graphforge not found");
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
 * registration) in a headless CI run with no `@graphforge/node` binding
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
      binding: { available: boolean; error?: string };
      project: { open: boolean; path?: string; name?: string };
      nextAction: string;
      timestamp: string;
    }>("graphforge.checkEnvironment");

    assert.ok(report, "checkEnvironment returned nothing");
    assert.equal(typeof report.binding.available, "boolean");
    assert.equal(typeof report.project.open, "boolean");
    // No @graphforge/node in devDependencies/peerDependencies is installed
    // for this test run, so the binding must fail closed rather than throw.
    assert.equal(report.binding.available, false);
    assert.equal(report.project.open, false);
    assert.ok(report.nextAction.length > 0, "nextAction must be actionable");
    assert.match(
      report.nextAction,
      /Setup Native Binding/,
      "next_action should point an agent at Setup Native Binding when the binding is missing",
    );
    assert.ok(!Number.isNaN(Date.parse(report.timestamp)), "timestamp must be ISO-parsable");
  });

  test("checkEnvironment with { silent: true } still returns the report (no editor/toast side effects)", async () => {
    const report = await vscode.commands.executeCommand<{ binding: { available: boolean } }>(
      "graphforge.checkEnvironment",
      { silent: true },
    );
    assert.ok(report);
    assert.equal(typeof report.binding.available, "boolean");
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

  test("showOntology does not throw", async () => {
    await assert.doesNotReject(
      Promise.resolve(vscode.commands.executeCommand("graphforge.showOntology")),
    );
  });

  test("showCapabilities does not throw when no project is open", async () => {
    // ensureProject() rejects (no project); the handler reports via a
    // fire-and-forget showErrorMessage (no action items) and resolves
    // immediately instead of opening the capabilities document.
    await assert.doesNotReject(
      Promise.resolve(vscode.commands.executeCommand("graphforge.showCapabilities")),
    );
  });
});

/**
 * NOT executed here — registration is covered above, but invoking these in
 * a headless test would either hang (they await a `showQuickPick` /
 * `showInputBox` / button-bearing `showErrorMessage` that nothing will ever
 * dismiss in CI) or require a live `@graphforge/node` binding + an open
 * FORMAT project, neither of which are available in this repo's CI image:
 *
 * - `graphforge.runQuery` / `graphforge.runQueryWithParams` — safe to call
 *   with `{ cypher, params }` args once a project is open (skips the
 *   editor-selection/input-box chain), but still need a live project +
 *   binding to actually execute Cypher.
 * - `graphforge.rank` / `rankAdvanced`, `cluster` / `clusterAdvanced`,
 *   `paths` / `pathsAdvanced`, `analyze` / `analyzeAdvanced`, `similar` /
 *   `similarAdvanced`, `find` — always walk a QuickPick (label/algorithm)
 *   chain today; see the "gaps" section of `docs/experience/agent-interop.md`.
 * - `graphforge.setupNativeBinding` — shows a `showQuickPick` of setup
 *   choices.
 * - `graphforge.initializeProjectHere` — awaits a button-bearing
 *   `showErrorMessage` when the binding is unavailable (the common CI case),
 *   then a QuickPick for the target folder.
 * - `graphforge.loadOntology` — requires an open project before it can reach
 *   its (blocking) file picker.
 * - `graphforge.showResultGraphAdvanced` — awaits two QuickPick/InputBox
 *   prompts before doing anything.
 *
 * A project-scoped integration test (with a real FORMAT-marked fixture
 * project and `@graphforge/node` installed) would be needed to safely
 * exercise these end-to-end; that is out of scope for this activation-time
 * smoke suite.
 */
