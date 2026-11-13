/* Installed recovery acceptance with a real native refusal and an intercepted publish boundary. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { createRequire } = require("node:module");

exports.run = async function run({ vscode, binding, root, fixture }) {
  const manifest = JSON.parse(fs.readFileSync(path.join(fixture, "manifest.json"), "utf8"));
  const core = require(binding);
  // VS Code scopes API objects per extension. Patch the installed extension's
  // own dialogs; the outer test entrypoint has a different window API object.
  const extension = vscode.extensions.getExtension("CurateLabsAI.graphforge");
  const ui = createRequire(path.join(extension.extensionPath, "dist/extension.js"))("vscode").window;
  assert.equal(core.version(), manifest.coreVersion);
  const project = path.join(root, "recovery-project");
  fs.cpSync(path.join(fixture, "project"), project, { recursive: true, errorOnExist: true, force: false });
  const native = core.runCli;
  const json = args => {
    const result = native([...args, "--project", project, "--json"]);
    assert.equal(result.exitCode, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const status = () => json(["status"]);
  const before = status();
  assert.equal(before.branch_uuid, manifest.branchUuid);
  assert.equal(before.head_version_uuid, manifest.headVersionUuid);
  const refusal = path.join(project, ".publish-refusals", "id-taken.json");
  const refusalHash = () => createHash("sha256").update(fs.readFileSync(refusal)).digest("hex");
  const originalHash = refusalHash();
  const negatives = [];
  for (const selection of [
    [randomUUID(), manifest.headVersionUuid],
    [manifest.branchUuid, randomUUID()],
  ]) {
    const result = native(["ontology", "regenerate-id", manifest.id, "--project", project,
      "--operation-uuid", randomUUID(), "--expected-branch-uuid", selection[0],
      "--expected-head-version-uuid", selection[1], "--yes", "--json"]);
    assert.notEqual(result.exitCode, 0);
    assert.deepEqual(status(), before, "refused guard changed Branch authority");
    assert.equal(refusalHash(), originalHash, "refused guard changed private authority");
    negatives.push({ exitCode: result.exitCode, unchanged: true });
  }

  console.log("Recovery qualification: native wrong-Branch/head refusals preserved authority");
  const restores = [];
  const replace = (object, key, value) => {
    const previous = object[key];
    object[key] = value;
    restores.push(() => { object[key] = previous; });
  };
  let replacement;
  let advancedHead;
  let publishCalls = 0;
  let inputs = 0;
  const confirmations = [];
  const sentinel = "QUALIFICATION_PUBLISH_INTERCEPTED";
  try {
    console.log("Recovery qualification: opening fixture through installed command");
    const opened = await vscode.commands.executeCommand("graphforge.openProject", project);
    assert.equal(opened.path, project, JSON.stringify(opened));
    console.log("Recovery qualification: fixture opened; intercepting only publication");
    replace(core, "runCli", argv => {
      const args = argv[0] === "--skills-bundle-dir" ? argv.slice(2) : argv;
      if (args[0] === "publish" && !args.includes("--help")) {
        publishCalls++;
        if (publishCalls === 1) {
          assert.equal(args[args.indexOf("--ref") + 1], "main");
          return { exitCode: 2, stdout: "", stderr: JSON.stringify({ error: {
            code: "GF_VALIDATION", details: { semantic_code: "hub.publish.id_taken" },
            message: `validation error: hub.publish.id_taken: ${manifest.id} is taken; run gf ontology regenerate-id ${manifest.id}`,
          } }) };
        }
        assert.equal(publishCalls, 2);
        assert.ok(replacement && advancedHead);
        assert.ok(!args.includes("--ref"));
        assert.equal(args[args.indexOf("--version-uuid") + 1], replacement.version_uuid);
        assert.notEqual(replacement.version_uuid, advancedHead);
        return { exitCode: 2, stdout: "", stderr: JSON.stringify({ error: { code: sentinel, message: sentinel } }) };
      }
      const result = native(argv);
      if (args[0] === "ontology" && args[1] === "regenerate-id" && !args.includes("--help") && result.exitCode === 0) {
        assert.equal(args[args.indexOf("--expected-branch-uuid") + 1], manifest.branchUuid);
        assert.equal(args[args.indexOf("--expected-head-version-uuid") + 1], manifest.headVersionUuid);
        replacement = JSON.parse(result.stdout);
        json(["commit", "-m", "Advance after recovery", "--query", "CREATE (:Thing {name:'Later head'})",
          "--author", "Qualification Fixture", "--committer", "Qualification Fixture"]);
        advancedHead = status().head_version_uuid;
      }
      return result;
    });
    replace(ui, "showInputBox", async () => ++inputs === 1 ? "fixture/local-recovery" : "main");
    replace(ui, "showErrorMessage", async (_message, ...actions) => actions.find(action => typeof action === "string" && action.startsWith("Regenerate the ID")));
    replace(ui, "showInformationMessage", async (_message, ...actions) => actions.find(action => action === "Publish Again"));
    replace(ui, "showWarningMessage", async (_message, options, action) => {
      assert.equal(options.modal, true);
      if (action === "Regenerate the ID") {
        assert.match(options.detail, /rewrite this project's references locally/);
        assert.ok(options.detail.includes(project));
      } else {
        confirmations.push(options.detail);
      }
      return action;
    });
    console.log("Recovery qualification: invoking interactive recovery");
    const outcome = await vscode.commands.executeCommand("graphforge.publishToHub");
    assert.equal(outcome.code, sentinel, JSON.stringify(outcome));
    assert.equal(publishCalls, 2);
    assert.equal(confirmations.length, 2);
    assert.ok(confirmations[1].includes(`Version ${replacement.version_uuid}`));
  } finally {
    for (const restore of restores.reverse()) restore();
    await vscode.commands.executeCommand("graphforge.closeProject");
  }
  const query = "MATCH (n:Thing) RETURN n.name AS name ORDER BY name";
  const frozen = json(["research", "version", "query", "--version", replacement.version_uuid, "--query", query]);
  assert.equal(frozen.contract, "graphforge-cli-result/1");
  assert.equal(frozen.columns[0].name, "name");
  assert.deepEqual(frozen.rows.map(row => row[0]), manifest.branchNames);
  const reopened = await vscode.commands.executeCommand("graphforge.openProject", project);
  assert.equal(reopened.path, project);
  const current = await vscode.commands.executeCommand("graphforge.runQuery", { cypher: query, resultName: "recovery-current" });
  assert.deepEqual(current.rows.map(row => row.name), manifest.currentNames);
  await vscode.commands.executeCommand("graphforge.closeProject");
  const modules = json(["ontology", "module", "list"]);
  assert.ok(JSON.stringify(modules).includes(replacement.id));
  assert.ok(!JSON.stringify(modules).includes(manifest.id));
  return { scope: "Installed native guarded recovery and exact-Version retry; publication boundary injected, no live Hub write",
    fixture: manifest, negatives, replacement, advancedHead, publishCalls, confirmations: 2,
    branchNames: frozen.rows.map(row => row[0]), currentNames: current.rows.map(row => row.name), durableReopen: true };
};
