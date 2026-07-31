import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import type { QueryResult } from "../session/types";
import { ResultGraphPanel } from "../webview/resultGraphPanel";
import { engineErrorCode, errorMessage } from "./shared";

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
  try {
    await session.ensureProject();
  } catch (err) {
    void vscode.window.showErrorMessage(errorMessage(err));
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
 * Missing-index errors must name the remediation command (#8 AC). The engine
 * error surface for this is still moving, so this matches defensively on the
 * message/code rather than one frozen string.
 */
async function handleFindError(err: unknown, label?: string): Promise<void> {
  const code = engineErrorCode(err);
  const message = errorMessage(err);
  const looksLikeMissingIndex = /index/i.test(message) || code === "GF_VALIDATION";

  if (!looksLikeMissingIndex) {
    void vscode.window.showErrorMessage(`GraphForge Find failed: ${message}`);
    return;
  }

  const remediation = label
    ? `GraphForge: Index Text… (label: ${label})`
    : "GraphForge: Index Text…";
  const choice = await vscode.window.showErrorMessage(
    `GraphForge Find failed${code ? ` [${code}]` : ""}: ${message}\n` +
      `This usually means the text/vector index is missing or stale. Run "${remediation}" then retry Find.`,
    "Index Text…",
  );
  if (choice) {
    await vscode.commands.executeCommand("graphforge.indexText", label);
  }
}
