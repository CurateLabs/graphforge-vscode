import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import { CommandOutcome, ensureProjectOrRecover, reportEngineError } from "./shared";

/**
 * Optional args (#36) so a coding agent can drive each index command via
 * `executeCommand` without any InputBox/QuickPick. `graphforge.indexText`
 * also still accepts a plain label string (the Find remediation path passes
 * one) — that presets the label but keeps the remaining prompts.
 */
export interface IndexTextArgs {
  label?: string;
  /** Property names to index; `[]` means engine auto-discovery, no prompt. */
  properties?: string[];
  rebuild?: boolean;
}
export interface IndexVectorArgs {
  label?: string;
  node?: string;
  vector?: number[];
  space?: string;
}
export interface InspectTextIndexArgs {
  label?: string;
}

/** JSON payload each index command returns and writes into the opened editor. */
interface IndexCommandPayload {
  command: string;
  result: unknown;
}

/**
 * Advanced, flat Index commands (#8) — never cascaded off `Find`. Each is a
 * standalone `GraphForge: …` palette entry so index build/inspect/rebuild
 * stays out of the primary Find path.
 */
export function registerIndexManagement(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "graphforge.indexText",
      (args?: string | IndexTextArgs) => runIndexText(session, args),
    ),

    // Accepts an optional plain label string like `indexText` so the
    // missing-index remediation toast (#39) can pre-fill it.
    vscode.commands.registerCommand(
      "graphforge.indexVector",
      (args?: string | IndexVectorArgs) => runIndexVector(session, args),
    ),

    vscode.commands.registerCommand(
      "graphforge.inspectTextIndex",
      (args?: InspectTextIndexArgs) => runInspectTextIndex(session, args),
    ),

    vscode.commands.registerCommand("graphforge.indexAdjacency", () =>
      runAdjacencyOp(session, "build"),
    ),

    vscode.commands.registerCommand("graphforge.inspectAdjacency", () =>
      runAdjacencyOp(session, "inspect"),
    ),

    vscode.commands.registerCommand("graphforge.rebuildAdjacency", () =>
      runAdjacencyOp(session, "rebuild"),
    ),
  );
}

async function pickLabel(
  session: GraphForgeSession,
  preset?: string,
): Promise<string | undefined> {
  if (preset) {
    return preset;
  }
  const labels = await session.labels();
  const picked = await vscode.window.showQuickPick(
    labels.length ? labels : ["Person"],
    { title: "GraphForge: Label", placeHolder: labels[0] ?? "Person" },
  );
  if (picked) {
    return picked;
  }
  return vscode.window.showInputBox({ title: "GraphForge: Label" });
}

async function showJsonResult(title: string, value: unknown): Promise<IndexCommandPayload> {
  const payload: IndexCommandPayload = { command: title, result: value ?? null };
  const doc = await vscode.workspace.openTextDocument({
    content: JSON.stringify(payload, null, 2),
    language: "json",
  });
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: true,
  });
  return payload;
}

async function runIndexText(
  session: GraphForgeSession,
  argsOrLabel?: string | IndexTextArgs,
): Promise<CommandOutcome<IndexCommandPayload>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  const args: IndexTextArgs =
    typeof argsOrLabel === "string" ? { label: argsOrLabel } : (argsOrLabel ?? {});
  const label = await pickLabel(session, args.label?.trim() || undefined);
  if (!label) {
    return { cancelled: true };
  }
  let properties: string[];
  if (args.properties) {
    properties = args.properties.map((s) => s.trim()).filter(Boolean);
  } else {
    const propsRaw = await vscode.window.showInputBox({
      title: "GraphForge: Index Text — Properties (optional)",
      prompt: "Comma-separated property names, or leave blank for auto-discovery",
      placeHolder: "name, description",
    });
    if (propsRaw === undefined) {
      return { cancelled: true };
    }
    properties = propsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  let rebuild: boolean;
  if (typeof args.rebuild === "boolean") {
    rebuild = args.rebuild;
  } else {
    const picked = await vscode.window.showQuickPick(["No", "Yes"], {
      title: "GraphForge: Index Text — Force rebuild?",
      placeHolder: "No",
    });
    if (picked === undefined) {
      return { cancelled: true };
    }
    rebuild = picked === "Yes";
  }

  try {
    const result = session.buildTextIndex(
      label,
      properties.length ? properties : undefined,
      rebuild,
    );
    const payload = await showJsonResult("Index Text", result);
    void vscode.window.showInformationMessage(
      `GraphForge: text index built for label "${label}".`,
    );
    return payload;
  } catch (err) {
    return reportEngineError("Index Text failed", err);
  }
}

async function runIndexVector(
  session: GraphForgeSession,
  argsOrLabel?: string | IndexVectorArgs,
): Promise<CommandOutcome<IndexCommandPayload>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  const args: IndexVectorArgs =
    typeof argsOrLabel === "string" ? { label: argsOrLabel } : (argsOrLabel ?? {});
  const label = await pickLabel(session, args?.label?.trim() || undefined);
  if (!label) {
    return { cancelled: true };
  }
  const node =
    args?.node?.trim() ||
    (await vscode.window.showInputBox({
      title: "GraphForge: Index Vector — Node UUID",
      prompt: "UUID of the node to upsert into the vector index",
    }));
  if (!node) {
    return { cancelled: true };
  }
  let vector: number[];
  if (args?.vector) {
    vector = args.vector.filter((n) => Number.isFinite(n));
  } else {
    const vectorRaw = await vscode.window.showInputBox({
      title: "GraphForge: Index Vector — Vector",
      prompt: "Comma-separated floats, e.g. 0.1, 0.2, 0.3",
    });
    if (!vectorRaw) {
      return { cancelled: true };
    }
    vector = vectorRaw
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
  }
  if (!vector.length) {
    const message = "Index Vector requires at least one finite number.";
    void vscode.window.showErrorMessage(`GraphForge: ${message}`);
    return { error: message };
  }
  const space =
    args && "space" in args
      ? args.space
      : await vscode.window.showInputBox({
          title: "GraphForge: Index Vector — Space (optional)",
        });

  try {
    const result = session.upsertVectorIndex(
      label,
      node,
      vector,
      space || undefined,
    );
    const payload = await showJsonResult("Index Vector", result);
    void vscode.window.showInformationMessage(
      `GraphForge: vector upserted for node ${node}.`,
    );
    return payload;
  } catch (err) {
    return reportEngineError("Index Vector failed", err);
  }
}

async function runInspectTextIndex(
  session: GraphForgeSession,
  args?: InspectTextIndexArgs,
): Promise<CommandOutcome<IndexCommandPayload>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  const label = await pickLabel(session, args?.label?.trim() || undefined);
  if (!label) {
    return { cancelled: true };
  }
  try {
    const result = session.inspectTextIndex(label);
    return await showJsonResult("Inspect Text Index", result);
  } catch (err) {
    return reportEngineError("Inspect Text Index failed", err);
  }
}

async function runAdjacencyOp(
  session: GraphForgeSession,
  op: "build" | "inspect" | "rebuild",
): Promise<CommandOutcome<IndexCommandPayload>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  try {
    const result =
      op === "build"
        ? session.buildAdjacencyIndex()
        : op === "rebuild"
          ? session.rebuildAdjacencyIndex()
          : session.inspectAdjacencyIndex();
    const payload = await showJsonResult(`Adjacency (${op})`, result);
    if (op !== "inspect") {
      void vscode.window.showInformationMessage(
        `GraphForge: adjacency index ${op === "build" ? "built" : "rebuilt"}.`,
      );
    }
    return payload;
  } catch (err) {
    return reportEngineError(`Adjacency (${op}) failed`, err);
  }
}
