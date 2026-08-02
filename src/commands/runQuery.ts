import * as path from "node:path";
import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import {
  persistQueryResultDocuments,
} from "../session/resultDocument";
import type { QueryResult } from "../session/types";
import type { ResultTableViewProvider } from "../views/resultTableView";
import {
  ensureProjectOrRecover,
  errorMessage,
  querySnippet,
  reportEngineError,
  SetupRecovery,
  withEngineProgress,
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
  /** Optional durable result name; defaults to results-YYYYMMDD-HHMMSS-mmm. */
  resultName?: string;
}

type RunQueryOutcome = SetupRecovery | QueryResult | { error: string; code?: string };

export function registerRunQuery(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
  results: ResultTableViewProvider,
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

        return executeAndShowResult(
          session,
          results,
          cypher,
          args?.params,
          args?.resultName,
        );
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

        return executeAndShowResult(
          session,
          results,
          cypher,
          params,
          args?.resultName,
        );
      },
    ),
  );
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
  session: GraphForgeSession,
  results: ResultTableViewProvider,
  cypher: string,
  params?: Record<string, unknown>,
  resultName?: string,
): Promise<QueryResult | { error: string; code?: string }> {
  try {
    // #31: lightweight in-flight indicator (status-bar spinner) so slow
    // queries aren't silent. Shared `withEngineProgress` (Window location, so
    // agent-invoked runs are never blocked) is the one progress idiom across
    // every command; it clears when the engine call settles either way, and
    // the result document / toast / graph behavior is unchanged.
    const result = await withEngineProgress("running query…", () =>
      session.execute(cypher, params),
    );
    const projectRoot = session.project?.rootPath;
    if (!projectRoot) {
      throw new Error("Query completed without an open GraphForge project.");
    }
    const documents = await persistQueryResultDocuments(projectRoot, result, resultName);
    // Refresh project-backed query/result lists after files are durable.
    session.notifyChanged();
    await results.show(result, "Cypher result", documents);

    const openGraph = vscode.workspace
      .getConfiguration("graphforge")
      .get<boolean>("openResultGraphOnQuery", true);
    if (openGraph) {
      const commands = await vscode.commands.getCommands(true);
      if (commands.includes("graphforge.showResultGraph")) {
        await vscode.commands.executeCommand("graphforge.showResultGraph", {
          title: "Cypher result",
        });
      }
    }

    void vscode.window.showInformationMessage(
      `GraphForge: ${result.rowCount} row(s) · saved to ${path.relative(projectRoot, documents.historyJsonPath ?? documents.jsonPath)}`,
    );
    return result;
  } catch (err) {
    // Curated toast (#28); the query echo and full raw engine message go to
    // the error output channel and the structured result, not the toast.
    return reportEngineError("query failed", err, `query: ${querySnippet(cypher)}`);
  }
}
