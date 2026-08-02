import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import { AnalystVerb, QueryResult } from "../session/types";
import type { ResultTableViewProvider } from "../views/resultTableView";
import {
  ensureProjectOrRecover,
  isMissingIndexError,
  isVectorIndexShapedInvocation,
  reportEngineError,
  reportMissingIndexError,
  SetupRecovery,
} from "./shared";

const CATALOG_VERBS: Array<Exclude<AnalystVerb, "find">> = [
  "rank",
  "cluster",
  "paths",
  "analyze",
  "similar",
];

const VERB_TITLE: Record<AnalystVerb, string> = {
  rank: "Rank",
  cluster: "Cluster",
  paths: "Paths",
  analyze: "Analyze",
  similar: "Similar",
  find: "Find",
};

interface LastUsed {
  label?: string;
  by?: string;
}

/**
 * `find` is registered as its own dedicated command (see `commands/find.ts`,
 * issue #8) with a tailored ≤2-input primary flow and Advanced index
 * remediation — it is intentionally excluded from this generic verb loop.
 */
export function registerAnalystVerbs(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
  results: ResultTableViewProvider,
): void {
  const verbs: AnalystVerb[] = [
    "rank",
    "cluster",
    "paths",
    "analyze",
    "similar",
  ];

  for (const verb of verbs) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`graphforge.${verb}`, async () => {
        return runVerb(context, session, results, verb, false);
      }),
    );
  }

  // Advanced: via / directed / writeProperty / vectorProperty — kept out of
  // the primary ≤2-interaction path (label + algorithm) as separate commands.
  for (const verb of CATALOG_VERBS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`graphforge.${verb}Advanced`, async () => {
        return runVerb(context, session, results, verb, true);
      }),
    );
  }
}

/**
 * Structured outcome of a verb command, returned to `executeCommand` callers.
 * Verb commands (`rank`, `cluster`, `paths`, `analyze`, `similar`, `find`,
 * and their `*Advanced` variants) still gather `label`/`by`/etc. via
 * QuickPick — there is no args-based bypass yet (see
 * `docs/experience/agent-interop.md` gaps) — but every invocation now
 * returns agent-copyable JSON instead of `void`.
 */
type VerbOutcome =
  | SetupRecovery
  | { cancelled: true }
  | { error: string }
  | (QueryResult & { verb: AnalystVerb; by?: string; label?: string });

async function runVerb(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
  results: ResultTableViewProvider,
  verb: AnalystVerb,
  advanced: boolean,
): Promise<VerbOutcome> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }

  const title = VERB_TITLE[verb] + (advanced ? " (Advanced)" : "");
  const lastKey = `graphforge.lastUsed.${verb}`;
  const last = context.workspaceState.get<LastUsed>(lastKey, {});

  const labels = await session.labels();
  let label: string | undefined;
  if (verb !== "find" && verb !== "paths") {
    const defaultLabel =
      last.label && (labels.length === 0 || labels.includes(last.label))
        ? last.label
        : (labels[0] ?? "Person");
    label =
      (await pickOrInput(
        `${title}: Label`,
        labels.length ? labels : ["Person"],
        defaultLabel,
      )) ?? undefined;
    if (!label) {
      return { cancelled: true };
    }
  } else if (verb === "find") {
    label =
      (await pickOrInput(`${title}: Label (optional)`, ["(any)", ...labels], "(any)")) ??
      undefined;
    if (label === "(any)") {
      label = undefined;
    }
  }

  let by: string | undefined;
  let catalogNote: string | undefined;
  if (verb !== "find") {
    const catalog = session.algorithmCatalog(verb as Exclude<AnalystVerb, "find">);
    catalogNote =
      catalog.source === "fallback"
        ? "static fallback — binding unavailable"
        : undefined;
    const defaultBy =
      last.by && catalog.items.includes(last.by) ? last.by : catalog.items[0];
    by =
      (await pickOrInput(
        `${title}: Algorithm (by)${catalogNote ? ` [${catalogNote}]` : ""}`,
        [...catalog.items],
        defaultBy ?? catalog.items[0],
      )) ?? undefined;
    if (!by) {
      return { cancelled: true };
    }
  }

  let query: string | undefined;
  let source: string | undefined;
  let target: string | undefined;
  let k: number | undefined;
  let via: string | undefined;
  let directed: boolean | undefined;
  let writeProperty: string | undefined;
  let vectorProperty: string | undefined;

  if (verb === "find") {
    query = await vscode.window.showInputBox({
      title: `GraphForge: ${title}`,
      prompt: "Text / hybrid search query",
    });
    if (query === undefined) {
      return { cancelled: true };
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

  if (advanced) {
    if (verb === "rank" || verb === "cluster" || verb === "paths" || verb === "analyze") {
      via = normalizeOptional(
        await vscode.window.showInputBox({
          title: `${title}: via relationship type (optional)`,
        }),
      );
      const directedPick = await vscode.window.showQuickPick(
        ["(engine default)", "directed", "undirected"],
        { title: `${title}: directed?` },
      );
      directed =
        directedPick === "directed" ? true : directedPick === "undirected" ? false : undefined;
    }
    if (verb === "similar") {
      via = normalizeOptional(
        await vscode.window.showInputBox({
          title: `${title}: via relationship type (optional)`,
        }),
      );
    }
    if (verb === "rank" || verb === "cluster") {
      writeProperty = normalizeOptional(
        await vscode.window.showInputBox({
          title: `${title}: writeProperty (optional)`,
          prompt: "Persist algorithm output back onto nodes under this property",
        }),
      );
    }
    if (verb === "cluster" || verb === "similar") {
      vectorProperty = normalizeOptional(
        await vscode.window.showInputBox({
          title: `${title}: vectorProperty (optional)`,
        }),
      );
    }
  }

  try {
    const result = await session.invokeVerb(verb, {
      label,
      by,
      via,
      directed,
      writeProperty,
      vectorProperty,
      query,
      source: source || undefined,
      target: target || undefined,
      k,
    });

    if (verb !== "find" && by) {
      await context.workspaceState.update(lastKey, { label, by });
    }

    await results.show(result, `${verb}${by ? ` · ${by}` : ""}`);

    const openGraph = vscode.workspace
      .getConfiguration("graphforge")
      .get<boolean>("openResultGraphOnQuery", true);
    if (openGraph) {
      const commands = await vscode.commands.getCommands(true);
      if (commands.includes("graphforge.showResultGraph")) {
        await vscode.commands.executeCommand("graphforge.showResultGraph", {
          title: `${verb}${by ? `:${by}` : ""}`,
        });
      }
    }

    void vscode.window.showInformationMessage(
      `GraphForge ${verb}: ${result.rowCount} row(s)`,
    );
    return { ...result, verb, by, label };
  } catch (err) {
    // #39: Similar/Cluster share Find's missing-index remediation — when a
    // vector-shaped invocation fails with an index-looking error, the toast
    // offers to run Index Vector… pre-filled with the same label instead of
    // dead-ending on the raw message.
    if (
      isMissingIndexError(err) &&
      isVectorIndexShapedInvocation(verb, { by, vectorProperty })
    ) {
      return reportMissingIndexError(`${verb} failed`, err, { index: "vector", label });
    }
    return reportEngineError(`${verb} failed`, err);
  }
}

function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
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
