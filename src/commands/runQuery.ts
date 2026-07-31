import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import { ResultGraphPanel } from "../webview/resultGraphPanel";

export function registerRunQuery(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("graphforge.runQuery", async () => {
      try {
        await session.ensureProject();
      } catch (err) {
        void vscode.window.showErrorMessage(
          err instanceof Error ? err.message : String(err),
        );
        return;
      }

      const editor = vscode.window.activeTextEditor;
      let cypher: string | undefined;
      if (editor) {
        const sel = editor.document.getText(editor.selection);
        cypher = sel.trim() ? sel : editor.document.getText();
      }
      if (!cypher?.trim()) {
        cypher = await vscode.window.showInputBox({
          title: "GraphForge: Run Query",
          prompt: "Enter an openCypher query",
          placeHolder: "MATCH (n) RETURN n LIMIT 25",
        });
      }
      if (!cypher?.trim()) {
        return;
      }

      try {
        const result = session.execute(cypher);
        const doc = await vscode.workspace.openTextDocument({
          content: formatResultTable(result.columns, result.rows),
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
          const payload = await session.toGraphPayload(result, "Cypher result");
          ResultGraphPanel.show(context.extensionUri, payload);
        }

        void vscode.window.showInformationMessage(
          `GraphForge: ${result.rowCount} row(s)`,
        );
      } catch (err) {
        void vscode.window.showErrorMessage(
          `GraphForge query failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
  );
}

function formatResultTable(
  columns: string[],
  rows: Array<Record<string, unknown>>,
): string {
  return JSON.stringify({ columns, rowCount: rows.length, rows }, null, 2);
}
