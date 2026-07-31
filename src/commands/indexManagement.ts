import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import { ensureProjectReady, reportEngineError } from "./shared";

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
      async (labelArg?: string) => {
        await runIndexText(session, labelArg);
      },
    ),

    vscode.commands.registerCommand("graphforge.indexVector", async () => {
      await runIndexVector(session);
    }),

    vscode.commands.registerCommand("graphforge.inspectTextIndex", async () => {
      await runInspectTextIndex(session);
    }),

    vscode.commands.registerCommand("graphforge.indexAdjacency", async () => {
      await runAdjacencyOp(session, "build");
    }),

    vscode.commands.registerCommand("graphforge.inspectAdjacency", async () => {
      await runAdjacencyOp(session, "inspect");
    }),

    vscode.commands.registerCommand("graphforge.rebuildAdjacency", async () => {
      await runAdjacencyOp(session, "rebuild");
    }),
  );
}

async function ensureReady(session: GraphForgeSession): Promise<boolean> {
  return ensureProjectReady(session);
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

async function showJsonResult(title: string, value: unknown): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    content: JSON.stringify({ command: title, result: value ?? null }, null, 2),
    language: "json",
  });
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: true,
  });
}

async function runIndexText(
  session: GraphForgeSession,
  labelArg?: string,
): Promise<void> {
  if (!(await ensureReady(session))) {
    return;
  }
  const label = await pickLabel(session, labelArg);
  if (!label) {
    return;
  }
  const propsRaw = await vscode.window.showInputBox({
    title: "GraphForge: Index Text — Properties (optional)",
    prompt: "Comma-separated property names, or leave blank for auto-discovery",
    placeHolder: "name, description",
  });
  if (propsRaw === undefined) {
    return;
  }
  const properties = propsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const rebuild = await vscode.window.showQuickPick(["No", "Yes"], {
    title: "GraphForge: Index Text — Force rebuild?",
    placeHolder: "No",
  });
  if (rebuild === undefined) {
    return;
  }

  try {
    const result = session.buildTextIndex(
      label,
      properties.length ? properties : undefined,
      rebuild === "Yes",
    );
    await showJsonResult("Index Text", result);
    void vscode.window.showInformationMessage(
      `GraphForge: text index built for label "${label}".`,
    );
  } catch (err) {
    reportEngineError("Index Text failed", err);
  }
}

async function runIndexVector(session: GraphForgeSession): Promise<void> {
  if (!(await ensureReady(session))) {
    return;
  }
  const label = await pickLabel(session);
  if (!label) {
    return;
  }
  const node = await vscode.window.showInputBox({
    title: "GraphForge: Index Vector — Node UUID",
    prompt: "UUID of the node to upsert into the vector index",
  });
  if (!node) {
    return;
  }
  const vectorRaw = await vscode.window.showInputBox({
    title: "GraphForge: Index Vector — Vector",
    prompt: "Comma-separated floats, e.g. 0.1, 0.2, 0.3",
  });
  if (!vectorRaw) {
    return;
  }
  const vector = vectorRaw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  if (!vector.length) {
    void vscode.window.showErrorMessage(
      "GraphForge: Index Vector requires at least one finite number.",
    );
    return;
  }
  const space = await vscode.window.showInputBox({
    title: "GraphForge: Index Vector — Space (optional)",
  });

  try {
    const result = session.upsertVectorIndex(
      label,
      node,
      vector,
      space || undefined,
    );
    await showJsonResult("Index Vector", result);
    void vscode.window.showInformationMessage(
      `GraphForge: vector upserted for node ${node}.`,
    );
  } catch (err) {
    reportEngineError("Index Vector failed", err);
  }
}

async function runInspectTextIndex(session: GraphForgeSession): Promise<void> {
  if (!(await ensureReady(session))) {
    return;
  }
  const label = await pickLabel(session);
  if (!label) {
    return;
  }
  try {
    const result = session.inspectTextIndex(label);
    await showJsonResult("Inspect Text Index", result);
  } catch (err) {
    reportEngineError("Inspect Text Index failed", err);
  }
}

async function runAdjacencyOp(
  session: GraphForgeSession,
  op: "build" | "inspect" | "rebuild",
): Promise<void> {
  if (!(await ensureReady(session))) {
    return;
  }
  try {
    const result =
      op === "build"
        ? session.buildAdjacencyIndex()
        : op === "rebuild"
          ? session.rebuildAdjacencyIndex()
          : session.inspectAdjacencyIndex();
    await showJsonResult(`Adjacency (${op})`, result);
    if (op !== "inspect") {
      void vscode.window.showInformationMessage(
        `GraphForge: adjacency index ${op === "build" ? "built" : "rebuilt"}.`,
      );
    }
  } catch (err) {
    reportEngineError(`Adjacency (${op}) failed`, err);
  }
}

