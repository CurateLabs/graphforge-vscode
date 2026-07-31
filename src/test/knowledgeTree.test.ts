import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import type { KnowledgeSummary } from "../session/types";
import { KnowledgeTreeProvider } from "../views/knowledgeTree";

/** Fake session exposing just what KnowledgeTreeProvider consumes. */
function makeFakeSession(summary: KnowledgeSummary): GraphForgeSession {
  const emitter = new vscode.EventEmitter<void>();
  return {
    onDidChange: emitter.event,
    project: { rootPath: "/tmp/fake-project", name: "fake-project" },
    knowledgeSummary: async () => summary,
  } as unknown as GraphForgeSession;
}

function baseSummary(overrides: Partial<KnowledgeSummary>): KnowledgeSummary {
  return {
    capabilityAvailable: true,
    assertionCount: 0,
    statusCounts: {},
    statusAvailable: true,
    assertions: [],
    ...overrides,
  };
}

type TreeNode = Awaited<ReturnType<KnowledgeTreeProvider["getChildren"]>>[number];

suite("KnowledgeTreeProvider epistemic status rendering", () => {
  test("assertion items carry status in description and a status-colored icon", async () => {
    const provider = new KnowledgeTreeProvider(
      makeFakeSession(
        baseSummary({
          assertionCount: 2,
          statusCounts: { supported: 1, statusless: 1 },
          assertions: [
            { assertionUuid: "11111111-aaaa-bbbb-cccc-000000000001", claim: "water is wet", status: "supported" },
            { assertionUuid: "22222222-aaaa-bbbb-cccc-000000000002", claim: "sky is green", status: "statusless" },
          ],
        }),
      ),
    );
    const children = await provider.getChildren();
    const assertions = children.filter(
      (n: TreeNode) => n.kind === "assertion",
    );
    assert.equal(assertions.length, 2);

    const supportedItem = provider.getTreeItem(assertions[0]);
    assert.ok(String(supportedItem.description).startsWith("supported · "));
    assert.equal((supportedItem.iconPath as vscode.ThemeIcon).id, "pass");
    assert.ok((supportedItem.iconPath as vscode.ThemeIcon).color);

    const statuslessItem = provider.getTreeItem(assertions[1]);
    assert.ok(String(statuslessItem.description).startsWith("statusless · "));
    assert.equal((statuslessItem.iconPath as vscode.ThemeIcon).id, "law");

    provider.dispose();
  });

  test("root includes a status-breakdown group with per-status counts", async () => {
    const provider = new KnowledgeTreeProvider(
      makeFakeSession(
        baseSummary({
          assertionCount: 3,
          statusCounts: { supported: 2, refuted: 1 },
          assertions: [
            { assertionUuid: "11111111-aaaa-bbbb-cccc-000000000001", claim: "a", status: "supported" },
            { assertionUuid: "22222222-aaaa-bbbb-cccc-000000000002", claim: "b", status: "supported" },
            { assertionUuid: "33333333-aaaa-bbbb-cccc-000000000003", claim: "c", status: "refuted" },
          ],
        }),
      ),
    );
    const children = await provider.getChildren();
    const breakdown = children.find(
      (n: TreeNode) => n.kind === "group" && n.label === "Status breakdown",
    );
    assert.ok(breakdown, "expected a Status breakdown group at the root");
    const rows = await provider.getChildren(breakdown);
    assert.deepEqual(
      rows.map((r: TreeNode) => (r.kind === "note" ? `${r.label}=${r.description}` : r.kind)),
      ["supported=2", "refuted=1"],
    );
    provider.dispose();
  });

  test("says statuses are unavailable instead of showing an empty breakdown", async () => {
    const provider = new KnowledgeTreeProvider(
      makeFakeSession(
        baseSummary({
          assertionCount: 1,
          statusAvailable: false,
          statusNote: "This @graphforge/node binding does not expose assertionStatus() — status unavailable.",
          assertions: [
            { assertionUuid: "11111111-aaaa-bbbb-cccc-000000000001", claim: "a" },
          ],
        }),
      ),
    );
    const children = await provider.getChildren();
    assert.equal(
      children.some((n: TreeNode) => n.kind === "group" && n.label === "Status breakdown"),
      false,
    );
    const unavailable = children.find(
      (n: TreeNode) => n.kind === "note" && n.label === "Status unavailable",
    );
    assert.ok(unavailable, "expected an explicit Status unavailable row");
    assert.ok(
      unavailable.kind === "note" &&
        String(unavailable.description).includes("assertionStatus"),
    );
    // Assertions without a resolved status keep the neutral icon, no status text.
    const assertionNode = children.find((n: TreeNode) => n.kind === "assertion");
    assert.ok(assertionNode);
    const item = provider.getTreeItem(assertionNode);
    assert.equal(String(item.description), "11111111");
    assert.equal((item.iconPath as vscode.ThemeIcon).id, "law");
    provider.dispose();
  });
});
