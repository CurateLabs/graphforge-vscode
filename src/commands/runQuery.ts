import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import type { QueryResult } from "../session/types";
import { ResultGraphPanel } from "../webview/resultGraphPanel";
import { errorMessage, offerSetupRecovery, querySnippet } from "./shared";

export function registerRunQuery(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("graphforge.runQuery", async () => {
      if (!(await ensureProjectOrRecover(session))) {
        return;
      }

      const cypher = await resolveCypherInput("GraphForge: Run Query");
      if (!cypher?.trim()) {
        return;
      }

      await executeAndShowResult(context, session, cypher);
    }),

    // Advanced (issue #3): parameters live here, not in the primary flow.
    vscode.commands.registerCommand("graphforge.runQueryWithParams", async () => {
      if (!(await ensureProjectOrRecover(session))) {
        return;
      }

      const cypher = await resolveCypherInput("GraphForge: Run Query with Parameters…");
      if (!cypher?.trim()) {
        return;
      }

      const paramsRaw = await vscode.window.showInputBox({
        title: "GraphForge: Run Query with Parameters…",
        prompt: "Parameters as a JSON object",
        placeHolder: '{"min": 28}',
        value: "{}",
      });
      if (paramsRaw === undefined) {
        return;
      }

      let params: Record<string, unknown>;
      try {
        const parsed = paramsRaw.trim() ? JSON.parse(paramsRaw) : {};
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("parameters must be a JSON object");
        }
        params = parsed as Record<string, unknown>;
      } catch (err) {
        void vscode.window.showErrorMessage(
          `GraphForge: invalid parameters JSON — ${errorMessage(err)}`,
        );
        return;
      }

      await executeAndShowResult(context, session, cypher, params);
    }),
  );
}

async function ensureProjectOrRecover(session: GraphForgeSession): Promise<boolean> {
  try {
    await session.ensureProject();
    return true;
  } catch (err) {
    await offerSetupRecovery(session, err);
    return false;
  }
}

/** Selection → whole document → single input box. One step, no cascading prompts. */
async function resolveCypherInput(title: string): Promise<string | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const sel = editor.document.getText(editor.selection);
    const text = sel.trim() ? sel : editor.document.getText();
    if (text.trim()) {
      return text;
    }
  }
  return vscode.window.showInputBox({
    title,
    prompt: "Enter an openCypher query",
    placeHolder: "MATCH (n) RETURN n LIMIT 25",
  });
}

async function executeAndShowResult(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
  cypher: string,
  params?: Record<string, unknown>,
): Promise<void> {
  try {
    const result = session.execute(cypher, params);
    const doc = await vscode.workspace.openTextDocument({
      content: formatResultDocument(result),
      language: "json",
    });
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true,
    });

    const openGraph = vscode.workspace
      .getConfiguration("graphforge")
      .get<boolean>("openResultGraphOnQuery", true);
    if (openGraph) {
      const payload = session.toGraphPayload(result, "Cypher result");
      ResultGraphPanel.show(context.extensionUri, payload);
    }

    void vscode.window.showInformationMessage(`GraphForge: ${result.rowCount} row(s)`);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `GraphForge query failed: ${errorMessage(err)} — query: ${querySnippet(cypher)}`,
    );
  }
}

/** Agent-copyable structured result: `{ columns, rows, rowCount }`. */
function formatResultDocument(result: QueryResult): string {
  return JSON.stringify(
    { columns: result.columns, rows: result.rows, rowCount: result.rowCount },
    null,
    2,
  );
}
