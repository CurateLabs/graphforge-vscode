import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import type { QueryResult } from "../session/types";
import { ResultGraphPanel } from "../webview/resultGraphPanel";
import {
  engineErrorCode,
  errorMessage,
  offerSetupRecovery,
  querySnippet,
  SetupRecovery,
} from "./shared";

/**
 * Optional args for `graphforge.runQuery` / `graphforge.runQueryWithParams`
 * so a coding agent that already has a Cypher string (and optionally bound
 * parameters) can call `vscode.commands.executeCommand("graphforge.runQuery",
 * { cypher, params })` and skip the editor-selection / QuickPick / input-box
 * chain entirely. Human palette-first UX is unchanged when no args (or a
 * blank `cypher`) are supplied.
 */
export interface RunQueryArgs {
  cypher?: string;
  params?: Record<string, unknown>;
}

type RunQueryOutcome = SetupRecovery | QueryResult | { error: string; code?: string };

export function registerRunQuery(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "graphforge.runQuery",
      async (args?: RunQueryArgs): Promise<RunQueryOutcome | undefined> => {
        const recovery = await ensureProjectOrRecover(session);
        if (recovery) {
          return recovery;
        }

        const cypher =
          args?.cypher?.trim() || (await resolveCypherInput("GraphForge: Run Query"));
        if (!cypher?.trim()) {
          return { error: "No Cypher query provided." };
        }

        return executeAndShowResult(context, session, cypher, args?.params);
      },
    ),

    // Advanced (issue #3): parameters live here, not in the primary flow.
    // Accepts the same `{ cypher, params }` args as `runQuery` so an agent
    // can pass bound parameters directly instead of the JSON input box.
    vscode.commands.registerCommand(
      "graphforge.runQueryWithParams",
      async (args?: RunQueryArgs): Promise<RunQueryOutcome | undefined> => {
        const recovery = await ensureProjectOrRecover(session);
        if (recovery) {
          return recovery;
        }

        const cypher =
          args?.cypher?.trim() ||
          (await resolveCypherInput("GraphForge: Run Query with Parameters…"));
        if (!cypher?.trim()) {
          return { error: "No Cypher query provided." };
        }

        let params: Record<string, unknown>;
        if (args?.params) {
          params = args.params;
        } else {
          const paramsRaw = await vscode.window.showInputBox({
            title: "GraphForge: Run Query with Parameters…",
            prompt: "Parameters as a JSON object",
            placeHolder: '{"min": 28}',
            value: "{}",
          });
          if (paramsRaw === undefined) {
            return { error: "No parameters provided." };
          }

          try {
            const parsed = paramsRaw.trim() ? JSON.parse(paramsRaw) : {};
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
              throw new Error("parameters must be a JSON object");
            }
            params = parsed as Record<string, unknown>;
          } catch (err) {
            const message = `invalid parameters JSON — ${errorMessage(err)}`;
            void vscode.window.showErrorMessage(`GraphForge: ${message}`);
            return { error: message };
          }
        }

        return executeAndShowResult(context, session, cypher, params);
      },
    ),
  );
}

async function ensureProjectOrRecover(
  session: GraphForgeSession,
): Promise<SetupRecovery | undefined> {
  try {
    await session.ensureProject();
    return undefined;
  } catch (err) {
    return offerSetupRecovery(session, err);
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
): Promise<QueryResult | { error: string; code?: string }> {
  try {
    const result = await session.execute(cypher, params);
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
      const payload = await session.toGraphPayload(result, "Cypher result");
      ResultGraphPanel.show(context.extensionUri, payload);
    }

    void vscode.window.showInformationMessage(`GraphForge: ${result.rowCount} row(s)`);
    return result;
  } catch (err) {
    const message = errorMessage(err);
    void vscode.window.showErrorMessage(
      `GraphForge query failed: ${message} — query: ${querySnippet(cypher)}`,
    );
    return { error: message, code: engineErrorCode(err) };
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
