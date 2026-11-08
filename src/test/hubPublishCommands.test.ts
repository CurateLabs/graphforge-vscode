import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { registerPublishToHub } from "../commands/publishToHub";
import { loadGraphForgeModule } from "../session/nativeLoader";
import type { GraphForgeSession } from "../session/graphForgeSession";

suite("Publish recovery command wiring (#103)", () => {
  const id = "ont_aaaaaaaaaaaaaaaa";
  const replacement = "0193e4f6-7b2a-7c3d-8e4f-5a6b7c8d9e0f";
  let restore: Array<() => void>;
  let command: (...args: any[]) => Promise<any>;
  let calls: string[][];
  let events: string[];
  let guidance: string;
  let cancelled: boolean;
  let owner: boolean;
  let prompts: number;

  setup(() => {
    restore = [];
    calls = [];
    events = [];
    prompts = 0;
    owner = false;
    cancelled = false;
    guidance = `${id} is taken; run gf ontology regenerate-id ${id}`;
    const replace = (object: object, key: string, value: unknown) => {
      const target = object as Record<string, unknown>;
      const previous = target[key];
      target[key] = value;
      restore.push(() => { target[key] = previous; });
    };
    const core = loadGraphForgeModule();
    assert.ok(core, "Tests require the installed or bundled Core facade");
    replace(core, "runCli", (argv: string[]) => {
      if (argv.includes("--help")) return { exitCode: 0, stdout: "publish", stderr: "" };
      calls.push(argv);
      if (argv[0] === "ontology") {
        events.push("regenerate");
        return { exitCode: 0, stdout: JSON.stringify({ id: "ont_bbbbbbbbbbbbbbbb", version_uuid: replacement }), stderr: "" };
      }
      if (calls.filter(call => call[0] === "publish").length === 1) {
        return { exitCode: 2, stdout: "", stderr: JSON.stringify({ error: {
          code: "GF_VALIDATION", message: `validation error: hub.publish.id_taken: ${guidance}`,
          details: { semantic_code: "hub.publish.id_taken" },
        } }) };
      }
      return { exitCode: 0, stderr: "", stdout: JSON.stringify({
        format: "graphforge-hub-publish/1", repository: { owner: owner ? "research" : "alice", repository: "demo" },
        refs: ["main"], revision: "revision", previous_revision: null,
        manifest_validator: "validator", operation_uuid: "operation", request_commitment: "commitment",
      }) };
    });
    replace(vscode.commands, "registerCommand", (_id: string, callback: typeof command) => {
      command = callback;
      return new vscode.Disposable(() => {});
    });
    replace(vscode.window, "withProgress", async (_options: unknown, task: () => unknown) => task());
    replace(vscode.window, "showInputBox", async (options: { value?: string }) => {
      prompts++;
      return options.value ?? (prompts === 1 ? "alice/demo" : "main");
    });
    replace(vscode.window, "showWarningMessage", async (_message: string, options: { modal: boolean; detail: string }, action: string) => {
      prompts++;
      assert.equal(options.modal, true);
      if (action === "Regenerate the ID") {
        events.push("confirm regeneration");
        assert.match(options.detail, /rewrite this project's references locally/);
        assert.match(options.detail, /\/work\/project/);
        return cancelled ? undefined : action;
      }
      events.push("confirm publish");
      return action;
    });
    replace(vscode.window, "showErrorMessage", async (_message: string, action: string) => { prompts++; return action; });
    replace(vscode.window, "showInformationMessage", async (_message: string, action?: string) => action);
    const session = {
      project: { rootPath: "/work/project" } as { rootPath: string } | undefined,
      closeProject: async () => { events.push("close"); session.project = undefined; },
      openProject: async (rootPath: string) => { events.push("reopen"); session.project = { rootPath }; },
    };
    registerPublishToHub({ subscriptions: [] } as unknown as vscode.ExtensionContext, session as unknown as GraphForgeSession);
  });

  teardown(() => { for (const undo of restore.reverse()) undo(); });

  test("modal confirmation gates Core rewriting, session reopen and separately confirmed replacement publication", async () => {
    const result = await command();
    assert.equal(result.repository, "alice/demo");
    assert.deepEqual(events, ["confirm publish", "confirm regeneration", "close", "regenerate", "reopen", "confirm publish"]);
    assert.equal(calls.length, 3);
    assert.ok(calls[1].includes("--yes"));
    assert.ok(calls[1].includes("--operation-uuid"));
    assert.equal(calls[2][calls[2].indexOf("--version-uuid") + 1], replacement);
    assert.ok(!calls[2].includes("--ref"));
  });

  test("cancelled modal leaves the session open and never regenerates or republishes", async () => {
    cancelled = true;
    assert.deepEqual(await command(), { cancelled: true });
    assert.deepEqual(events, ["confirm publish", "confirm regeneration"]);
    assert.equal(calls.length, 1);
  });

  test("organization hint selects that organization and reuses normal publish confirmation", async () => {
    owner = true;
    guidance = `${id} is taken; publish as research instead of regenerating`;
    const result = await command();
    assert.equal(result.repository, "research/demo");
    assert.equal(calls[1][1], "research/demo");
    assert.deepEqual(events, ["confirm publish", "confirm publish"]);
  });

  test("agent calls return recovery actions without any prompts or local mutation", async () => {
    const result = await command({ repository: "alice/demo", ref: "main", confirm: true });
    assert.equal(result.code, "hub.publish.id_taken");
    assert.deepEqual(result.actions, [{ kind: "regenerateId", id }]);
    assert.equal(prompts, 0);
    assert.deepEqual(events, []);
    assert.equal(calls.length, 1);
  });
});
