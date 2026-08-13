import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  resolveWorkspaceScriptPath,
  workspaceScriptPolicyError,
} from "../modules/workspaceScript";

suite("workspace-script module safety", () => {
  test("requires both a global opt-in and Workspace Trust", () => {
    assert.match(workspaceScriptPolicyError(undefined, true) ?? "", /disabled/);
    assert.match(workspaceScriptPolicyError(false, true) ?? "", /disabled/);
    assert.match(workspaceScriptPolicyError(true, false) ?? "", /trusted/);
    assert.equal(workspaceScriptPolicyError(true, true), undefined);
  });

  test("accepts contained scripts and rejects symlink escapes", async () => {
    const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "graphforge-module-"));
    const moduleRoot = path.join(temp, "module");
    const outside = path.join(temp, "outside.cjs");
    await fs.promises.mkdir(moduleRoot);
    await fs.promises.writeFile(path.join(moduleRoot, "graphforge-module.json"), "{}\n");
    await fs.promises.writeFile(path.join(moduleRoot, "activate.cjs"), "module.exports = () => {};\n");
    await fs.promises.writeFile(outside, "module.exports = () => {};\n");
    await fs.promises.symlink(outside, path.join(moduleRoot, "escaped.cjs"));

    try {
      assert.equal(
        await resolveWorkspaceScriptPath(
          path.join(moduleRoot, "graphforge-module.json"),
          "activate.cjs",
        ),
        await fs.promises.realpath(path.join(moduleRoot, "activate.cjs")),
      );
      await assert.rejects(
        resolveWorkspaceScriptPath(
          path.join(moduleRoot, "graphforge-module.json"),
          "escaped.cjs",
        ),
        /inside its module folder/,
      );
    } finally {
      await fs.promises.rm(temp, { recursive: true, force: true });
    }
  });
});
