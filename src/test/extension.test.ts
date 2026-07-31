import * as assert from "node:assert/strict";
import * as vscode from "vscode";

suite("GraphForge extension", () => {
  test("activates and registers core commands", async () => {
    const ext = vscode.extensions.getExtension("CurateLabs.graphforge");
    assert.ok(ext, "extension CurateLabs.graphforge not found");
    await ext.activate();
    assert.equal(ext.isActive, true);

    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      "graphforge.runQuery",
      "graphforge.runQueryWithParams",
      "graphforge.rank",
      "graphforge.showOntology",
      "graphforge.showResultGraph",
      "graphforge.openProject",
      "graphforge.checkEnvironment",
      "graphforge.setupNativeBinding",
      "graphforge.setupPythonBinding",
      "graphforge.initializeProjectHere",
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
    ]) {
      assert.ok(commands.includes(id), `missing command ${id}`);
    }
  });

  test("cypher language is registered", async () => {
    const languages = await vscode.languages.getLanguages();
    assert.ok(languages.includes("cypher"), "cypher language missing");
  });
});
