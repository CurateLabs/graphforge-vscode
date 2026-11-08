import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { registerFind } from "../commands/find";
import { registerPower } from "../commands/power";
import { registerCheckpoints } from "../commands/checkpoints";
import { registerKnowledgeCommands } from "../commands/knowledgeCommands";
import type { GraphForgeSession } from "../session/graphForgeSession";
import type { ResultTableViewProvider } from "../views/resultTableView";
import type { QueryResult } from "../session/types";
import { queryResultPage, RESULT_PAGE_BYTES, type ResultPageMetadata } from "../session/resultRows";

suite("bounded command completion", () => {
  const callbacks = new Map<string, (...args: any[]) => any>();
  let restore: Array<() => void>;
  let query: string;
  let shown: number;
  let result: QueryResult;
  let canonicalBytes: Buffer;
  let seen: unknown;

  setup(() => {
    restore = [];
    callbacks.clear();
    const replace = (object: object, key: string, value: unknown) => {
      const target = object as Record<string, unknown>;
      const previous = target[key];
      target[key] = value;
      restore.push(() => { target[key] = previous; });
    };
    replace(vscode.commands, "registerCommand", (id: string, callback: (...args: any[]) => any) => {
      callbacks.set(id, callback);
      return new vscode.Disposable(() => {});
    });
    replace(vscode.window, "showInputBox", async () => query);
    replace(vscode.window, "showQuickPick", async () => "(any)");
    replace(vscode.window, "showInformationMessage", async () => undefined);
    replace(vscode.window, "showErrorMessage", async () => undefined);
    replace(vscode.workspace, "openTextDocument", async () => ({}));
    replace(vscode.window, "showTextDocument", async () => { shown++; });
    const session = {
      activeRuntime: "node",
      ensureProject: async () => ({ rootPath: "/tmp/command-boundary" }),
      labels: async () => [],
      invokeVerb: async () => result,
      resultPage: (source: QueryResult, metadata?: ResultPageMetadata) => queryResultPage(source, 0, undefined, metadata),
      assertResultPageCurrent() {},
      algorithmCatalog: () => ({ source: "live", items: ["pagerank"] }),
      prepareInvocation: () => ({ verb: "rank", algorithm: "pagerank", fingerprint: "fixture", canonicalBytes }),
      invokeDescriptor: () => result,
      listAssertions: async (args: unknown) => { seen = args; return result; },
      listCheckpoints: async (...args: unknown[]) => { seen = args; return result; },
      listAlgorithmRuns: async (...args: unknown[]) => { seen = args; return result; },
    };
    const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
    const typed = session as unknown as GraphForgeSession;
    registerFind(context, typed, { show: async () => { shown++; } } as unknown as ResultTableViewProvider);
    registerPower(context, typed);
    registerCheckpoints(context, typed);
    registerKnowledgeCommands(context, typed, () => {});
    query = "fixture";
    shown = 0;
    result = { columns: [], rows: [], rowCount: 0 };
    canonicalBytes = Buffer.from("fixture");
    seen = undefined;
  });

  teardown(() => { for (const undo of restore.reverse()) undo(); });

  test("Find returns structured row and metadata budget errors", async () => {
    result = { columns: ["text"], rows: [{ text: "x".repeat(RESULT_PAGE_BYTES) }], rowCount: 1 };
    const row = await callbacks.get("graphforge.find")!();
    assert.match(row.error, /RESULT_PAGE_ROW_TOO_LARGE/);
    result = { columns: [], rows: [], rowCount: 0 };
    query = "q".repeat(RESULT_PAGE_BYTES);
    const metadata = await callbacks.get("graphforge.find")!();
    assert.match(metadata.error, /RESULT_PAGE_METADATA_TOO_LARGE/);
    assert.equal(shown, 0, "invalid pages never reach Results");
  });

  test("descriptor replies budget canonical bytes plus the optional invocation", async () => {
    const invoke = callbacks.get("graphforge.exportInvocationDescriptor")!;
    canonicalBytes = Buffer.alloc(3 * 1024 * 1024 + 1);
    const base = await invoke({ verb: "rank", label: "fixture", by: "pagerank", invoke: false });
    assert.match(base.error, /RESULT_REPLY_TOO_LARGE/);
    assert.equal(shown, 0, "an oversized descriptor is rejected before opening an editor");
    canonicalBytes = Buffer.alloc(2 * 1024 * 1024);
    result = { columns: ["text"], rows: [{ text: "x".repeat(2 * 1024 * 1024) }], rowCount: 1 };
    assert.ok(Buffer.byteLength(JSON.stringify(queryResultPage(result))) < RESULT_PAGE_BYTES);
    const combined = await invoke({ verb: "rank", label: "fixture", by: "pagerank", invoke: true });
    assert.match(combined.error, /RESULT_REPLY_TOO_LARGE/);
    assert.ok(Buffer.byteLength(JSON.stringify(combined)) < RESULT_PAGE_BYTES);
  });

  test("all native list commands forward the opaque after cursor", async () => {
    result.nextPageToken = "opaque next cursor";
    for (const [command, args, expected] of [
      ["graphforge.listAssertions", { graphUuid: "graph", limit: 2, after: "opaque cursor" }, { graphUuid: "graph", limit: 2, after: "opaque cursor" }],
      ["graphforge.listCheckpoints", { limit: 2, after: "opaque cursor" }, [2, "opaque cursor"]],
      ["graphforge.listAlgorithmRuns", { algorithm: "pagerank", limit: 2, after: "opaque cursor" }, ["pagerank", 2, "opaque cursor"]],
    ] as const) {
      const page = await callbacks.get(command)!(args);
      assert.deepEqual(seen, expected, command);
      assert.equal(page.nextPageToken, result.nextPageToken, command);
    }
  });
});
