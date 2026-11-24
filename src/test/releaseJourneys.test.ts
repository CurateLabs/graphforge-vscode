import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Executable evidence for the release scenarios in
 * docs/experience/release-journeys.md that an Extension Development Host can
 * prove offline with the Core binding bundled by `npm run compile`. Network,
 * production-Hub and credentialed steps belong to the installed qualification
 * runners and the human checklist in that document.
 */
suite("Release journeys — bundled Core (#95)", () => {
  let extension: vscode.Extension<unknown>;
  let pinnedCore: string;
  let scratch: string;

  suiteSetup(async () => {
    extension = vscode.extensions.getExtension("CurateLabsAI.graphforge")!;
    await extension.activate();
    pinnedCore = extension.packageJSON.dependencies["@curatelabs/graphforge"];
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "gf-release-journeys-"));
  });

  suiteTeardown(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  test("Scenario: the installed build declares its qualified Core and reports the bundled Core as qualified", async () => {
    const provenance = JSON.parse(
      fs.readFileSync(path.join(extension.extensionPath, "dist/core/provenance.json"), "utf8"),
    ) as { version: string };
    assert.equal(provenance.version, pinnedCore, "the bundled Core is the exact package.json pin");

    const report = await vscode.commands.executeCommand<{
      nodeBinding: { available: boolean };
      core: {
        declared: { range: string; refuseBelow: string };
        node?: { version?: string; status: string; code?: string };
      };
    }>("graphforge.checkEnvironment", { silent: true });

    assert.deepEqual(report.core.declared, extension.packageJSON.graphforge.qualifiedCore);
    assert.equal(report.nodeBinding.available, true, "the bundled Core binding loads without a separate install");
    assert.equal(report.core.node?.version, pinnedCore);
    assert.equal(report.core.node?.status, "qualified");
    assert.equal(report.core.node?.code, undefined);
  });

  test("Scenario: an agent publish without confirm: true is refused before Core runs", async () => {
    const projectPath = path.join(scratch, "unconfirmed");
    fs.mkdirSync(projectPath);
    const result = await vscode.commands.executeCommand<{ code?: string; nextAction?: string }>(
      "graphforge.publishToHub",
      { repository: "opendata/openalex", ref: "main", projectPath },
    );
    assert.equal(result?.code, "CONFIRMATION_REQUIRED", JSON.stringify(result));
    assert.match(result.nextAction ?? "", /confirm: true/);
    assert.match(result.nextAction ?? "", /unconfirmed/, "the retry keeps the requested project");
  });

  test("Scenario: an agent publish that asks for previews is refused before Core runs", async () => {
    const projectPath = path.join(scratch, "previews");
    fs.mkdirSync(projectPath);
    const result = await vscode.commands.executeCommand<{ code?: string; error?: string; nextAction?: string }>(
      "graphforge.publishToHub",
      { repository: "opendata/openalex", ref: "main", projectPath, previews: ["chart.png"], confirm: true },
    );
    assert.equal(result?.code, "HUB_PUBLISH_PREVIEWS_UNAVAILABLE", JSON.stringify(result));
    assert.ok((result.nextAction ?? "").length > 0);
  });

  test("Scenario: an agent publish with no project open names the next action", async () => {
    await vscode.commands.executeCommand("graphforge.closeProject");
    const result = await vscode.commands.executeCommand<{ code?: string; nextAction?: string }>(
      "graphforge.publishToHub",
      { repository: "opendata/openalex", ref: "main", confirm: true },
    );
    assert.equal(result?.code, "HUB_PUBLISH_PROJECT_REQUIRED", JSON.stringify(result));
    assert.match(result.nextAction ?? "", /graphforge\.openProject/);
  });
});
