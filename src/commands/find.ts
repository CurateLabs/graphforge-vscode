import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import type { QueryResult } from "../session/types";
import { ResultGraphPanel } from "../webview/resultGraphPanel";
import {
  ensureProjectOrRecover,
  isMissingIndexError,
  reportEngineError,
  reportMissingIndexError,
} from "./shared";

/**
 * `GraphForge: Find` (#8) — palette-first hybrid text/vector search.
 *
 * Primary flow is exactly two inputs (query + optional label) per the UX
 * doctrine; index build/inspect/rebuild live in separate flat Advanced
 * commands (see `commands/indexManagement.ts`).
 */
export function registerFind(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("graphforge.find", async () => {
      await runFind(context, session);
    }),
  );
}

async function runFind(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
): Promise<void> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return;
  }

  const query = await vscode.window.showInputBox({
    title: "GraphForge: Find",
    prompt: "Text / hybrid search query",
    placeHolder: "e.g. climate risk mitigation",
  });
  if (query === undefined) {
    return;
  }

  const labels = await session.labels();
  const labelPick = await vscode.window.showQuickPick(["(any)", ...labels], {
    title: "GraphForge: Find — Label (optional)",
    placeHolder: "(any)",
  });
  if (labelPick === undefined) {
    return;
  }
  const label = labelPick === "(any)" ? undefined : labelPick;

  let result: QueryResult;
  try {
    result = await session.invokeVerb("find", { query, label, k: 10 });
  } catch (err) {
    await handleFindError(err, label);
    return;
  }

  const doc = await vscode.workspace.openTextDocument({
    content: JSON.stringify(
      {
        verb: "find",
        query,
        label,
        columns: result.columns,
        rowCount: result.rowCount,
        rows: result.rows,
      },
      null,
      2,
    ),
    language: "json",
  });
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: true,
  });

  const hasUuids = result.columns.some((c) => /uuid/i.test(c));
  const openGraph = vscode.workspace
    .getConfiguration("graphforge")
    .get<boolean>("openResultGraphOnQuery", true);
  if (hasUuids && openGraph && result.rowCount > 0) {
    const payload = await session.toGraphPayload(result, `find: ${query ?? "(all)"}`);
    ResultGraphPanel.show(context.extensionUri, payload);
  }

  void vscode.window.showInformationMessage(
    `GraphForge Find: ${result.rowCount} hit(s)`,
  );
}

/**
 * Missing-index errors must name the remediation command (#8 AC). Detection
 * and the remediation toast are shared with Similar/Cluster (#39) via
 * `isMissingIndexError` / `reportMissingIndexError`.
 */
async function handleFindError(err: unknown, label?: string): Promise<void> {
  if (!isMissingIndexError(err)) {
    reportEngineError("Find failed", err);
    return;
  }
  reportMissingIndexError("Find failed", err, { index: "text", label });
}
