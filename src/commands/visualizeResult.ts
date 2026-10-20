import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import {
  isXygResultLayer,
  ledgerEntryFor,
  loadXygNative,
  selectableIntents,
  XYG_HOSTS,
  type XygHost,
  type XygIntent,
} from "../session/xygAdapter";
import {
  XygVisualizationPanel,
  type XygVisualizationOutcome,
} from "../webview/xygVisualizationPanel";

export interface VisualizeResultArgs {
  /** Explicit intent; XYG never picks one. Prompted when several apply. */
  intent?: XygIntent;
  host?: XygHost;
  title?: string;
  instanceId?: string;
  /** Automatic open after a query/verb: draw only a `graph` intent, never prompt. */
  auto?: boolean;
}

export type VisualizeResultOutcome =
  | ({ panel: "opened" | "updated" } & XygVisualizationOutcome)
  | { panel: "skipped"; reason: string }
  | { panel: "cancelled" }
  | { error: string; code: string; nextAction: string };

/** Every intent XYG accepts; Rust validates it against its ledger. */
const ALL_INTENTS: readonly XygIntent[] = [
  "graph",
  "table",
  "bar-chart",
  "parallel-coordinates",
  "embedding-coordinates",
];

const INTENT_LABELS: Record<XygIntent, string> = {
  graph: "Graph — join onto the current graph",
  table: "Table",
  "bar-chart": "Bar chart",
  "parallel-coordinates": "Parallel coordinates (full embedding vectors)",
  "embedding-coordinates": "Embedding coordinates (caller 2D placement)",
};

export function configuredXygHost(): XygHost {
  const value = vscode.workspace
    .getConfiguration("graphforge")
    .get<string>("visualization.xygHost", "native");
  return (XYG_HOSTS as readonly string[]).includes(value) ? (value as XygHost) : "native";
}

function failure(code: string, error: string, nextAction: string): VisualizeResultOutcome {
  return { error, code, nextAction };
}

/**
 * The intents a user may choose for `metadata`, from XYG's Rust ledger when
 * the native host is available. On a WASM-only machine the ledger is not
 * readable host-side, so every intent is offered and Rust rejects
 * unsupported ones with `GF_COMPOSE_INTENT_UNSUPPORTED`.
 */
async function intentsFor(metadata: Record<string, string> | undefined): Promise<readonly XygIntent[]> {
  const loaded = await loadXygNative();
  if (!loaded.ok) return ALL_INTENTS;
  return selectableIntents(ledgerEntryFor(loaded.api.graphforgeLedger(), metadata));
}

export function registerVisualizeResultCommand(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "graphforge.visualizeResult",
      async (args: VisualizeResultArgs = {}): Promise<VisualizeResultOutcome> => {
        const result = session.getLastResult();
        if (!result) {
          return failure("GF_RESULT_MISSING", "There is no result to visualize.", "Run a query or analyst verb first.");
        }
        const metadata = result.schema?.metadata;
        if (!isXygResultLayer(metadata)) {
          return failure(
            "GF_RESULT_NOT_ALGORITHM",
            "Only GraphForge algorithm and search results are composed by XYG.",
            "Use GraphForge: Show Result Graph for Cypher results.",
          );
        }
        const ipc = session.resultIpcBytes(result);
        if (!ipc) {
          return failure(
            "GF_RESULT_BYTES_UNAVAILABLE",
            "The engine bytes for this result are no longer available.",
            "Re-run the query or verb, then visualize it again.",
          );
        }

        const intents = await intentsFor(metadata);
        let intent = args.intent;
        if (!intent && args.auto) {
          if (!intents.includes("graph")) {
            return { panel: "skipped", reason: "This result has no graph composition; it stays in the Results table." };
          }
          intent = "graph";
        }
        if (!intent && intents.length === 1) intent = intents[0];
        if (!intent) {
          const picked = await vscode.window.showQuickPick(
            intents.map((value) => ({ label: INTENT_LABELS[value], value })),
            { title: "GraphForge: Visualize result as…" },
          );
          if (!picked) return { panel: "cancelled" };
          intent = picked.value;
        }
        if (!intents.includes(intent)) {
          return failure(
            "GF_COMPOSE_INTENT_UNSUPPORTED",
            `XYG does not offer the "${intent}" intent for this result.`,
            `Choose one of: ${intents.join(", ")}.`,
          );
        }

        const host = args.host ?? configuredXygHost();
        const title = args.title ?? result.algorithm ?? metadata?.["graphforge.verb"] ?? "Result";
        const shown = await XygVisualizationPanel.show(
          context.extensionUri,
          {
            title,
            result,
            ipc,
            intent,
            host,
            readBase: () => session.readBaseGraph(),
          },
          args.instanceId,
        );
        if (shown.outcome.error && !args.auto) {
          const { code, message, nextAction } = shown.outcome.error;
          void vscode.window.showErrorMessage(`GraphForge (${code}): ${message}`, { detail: nextAction });
        }
        return { panel: shown.status, ...shown.outcome };
      },
    ),
  );
}
