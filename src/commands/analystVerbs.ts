import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import {
  ANALYZE_BY,
  AnalystVerb,
  CLUSTER_BY,
  PATHS_BY,
  RANK_BY,
  SIMILAR_BY,
} from "../session/types";
import { ResultGraphPanel } from "../webview/resultGraphPanel";

const VERB_BY: Record<Exclude<AnalystVerb, "find" | "paths">, readonly string[]> = {
  rank: RANK_BY,
  cluster: CLUSTER_BY,
  analyze: ANALYZE_BY,
  similar: SIMILAR_BY,
};

export function registerAnalystVerbs(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
): void {
  const verbs: AnalystVerb[] = [
    "rank",
    "cluster",
    "paths",
    "analyze",
    "similar",
    "find",
  ];

  for (const verb of verbs) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`graphforge.${verb}`, async () => {
        await runVerb(context, session, verb);
      }),
    );
  }
}

async function runVerb(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
  verb: AnalystVerb,
): Promise<void> {
  try {
    await session.ensureProject();
  } catch (err) {
    void vscode.window.showErrorMessage(
      err instanceof Error ? err.message : String(err),
    );
    return;
  }

  const labels = await session.labels();
  let label: string | undefined;
  if (verb !== "find" && verb !== "paths") {
    label =
      (await pickOrInput(
        "Label",
        labels.length ? labels : ["Person"],
        labels[0] ?? "Person",
      )) ?? undefined;
    if (!label) {
      return;
    }
  } else if (verb === "find") {
    label =
      (await pickOrInput("Label (optional)", ["(any)", ...labels], "(any)")) ??
      undefined;
    if (label === "(any)") {
      label = undefined;
    }
  }

  let by: string | undefined;
  if (verb === "paths") {
    by =
      (await pickOrInput("Algorithm (by)", [...PATHS_BY], PATHS_BY[0])) ??
      undefined;
  } else if (verb !== "find") {
    const catalog = VERB_BY[verb as keyof typeof VERB_BY];
    by =
      (await pickOrInput("Algorithm (by)", [...catalog], catalog[0])) ??
      undefined;
  }
  if (verb !== "find" && !by) {
    return;
  }

  let query: string | undefined;
  let source: string | undefined;
  let target: string | undefined;
  let k: number | undefined;

  if (verb === "find") {
    query = await vscode.window.showInputBox({
      title: "GraphForge: Find",
      prompt: "Text / hybrid search query",
    });
    if (query === undefined) {
      return;
    }
    const kRaw = await vscode.window.showInputBox({
      title: "Limit",
      value: "10",
    });
    k = kRaw ? Number(kRaw) : 10;
  }

  if (verb === "paths") {
    source = await vscode.window.showInputBox({
      title: "Source node UUID (optional)",
    });
    target = await vscode.window.showInputBox({
      title: "Target node UUID (optional)",
    });
  }

  try {
    const result = await session.invokeVerb(verb, {
      label,
      by,
      query,
      source: source || undefined,
      target: target || undefined,
      k,
    });

    const doc = await vscode.workspace.openTextDocument({
      content: JSON.stringify(
        {
          verb,
          by,
          label,
          algorithm: result.algorithm,
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

    const openGraph = vscode.workspace
      .getConfiguration("graphforge")
      .get<boolean>("openResultGraphOnQuery", true);
    if (openGraph) {
      ResultGraphPanel.show(
        context.extensionUri,
        session.toGraphPayload(result, `${verb}${by ? `:${by}` : ""}`),
      );
    }

    void vscode.window.showInformationMessage(
      `GraphForge ${verb}: ${result.rowCount} row(s)`,
    );
  } catch (err) {
    void vscode.window.showErrorMessage(
      `GraphForge ${verb} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function pickOrInput(
  title: string,
  items: string[],
  value: string,
): Promise<string | undefined> {
  const picked = await vscode.window.showQuickPick(items, {
    title: `GraphForge: ${title}`,
    placeHolder: value,
  });
  if (picked) {
    return picked;
  }
  return vscode.window.showInputBox({ title: `GraphForge: ${title}`, value });
}
