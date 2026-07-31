import * as vscode from "vscode";
import { decodeTable } from "../session/arrowCodec";
import type { GraphForgeSession } from "../session/graphForgeSession";
import type { QueryResult, TableRow } from "../session/types";
import { ensureProjectReady, reportEngineError } from "./shared";

const DIFF_SCOPES = [
  "summary",
  "graph",
  "ontology",
  "configuration",
  "capabilities",
  "provenance",
  "knowledge",
  "epistemic",
  "all",
];
const DIFF_DETAILS = ["summary", "records"];

/**
 * Checkpoint commands (#9) — flat palette entries, no cascading checkpoint
 * wizard. `Revert to Checkpoint…` requires the analyst to type the exact
 * checkpoint name back as a hard confirmation before the destructive engine
 * call runs.
 */
export function registerCheckpoints(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("graphforge.createCheckpoint", async () => {
      await runCreateCheckpoint(session);
    }),

    vscode.commands.registerCommand("graphforge.listCheckpoints", async () => {
      await runListCheckpoints(session);
    }),

    vscode.commands.registerCommand("graphforge.openCheckpoint", async () => {
      await runOpenCheckpoint(session);
    }),

    vscode.commands.registerCommand("graphforge.diffCheckpoints", async () => {
      await runDiffCheckpoints(session);
    }),

    vscode.commands.registerCommand("graphforge.deleteCheckpoint", async () => {
      await runDeleteCheckpoint(session);
    }),

    vscode.commands.registerCommand("graphforge.revertToCheckpoint", async () => {
      await runRevertToCheckpoint(session);
    }),
  );
}

async function ensureReady(session: GraphForgeSession): Promise<boolean> {
  return ensureProjectReady(session);
}

function checkpointNameOf(row: TableRow): string | undefined {
  const v = row.name ?? row.checkpoint_name ?? row.checkpointName;
  return v == null ? undefined : String(v);
}

async function pickCheckpointName(
  session: GraphForgeSession,
  title: string,
): Promise<string | undefined> {
  try {
    const result = await session.listCheckpoints(200);
    const items = result.rows
      .map((row) => {
        const name = checkpointNameOf(row);
        if (!name) {
          return undefined;
        }
        const created =
          row.created_at ?? row.createdAt ?? row.checkpoint_uuid ?? "";
        return {
          label: name,
          description: String(created),
        };
      })
      .filter((v): v is { label: string; description: string } => Boolean(v));
    if (!items.length) {
      const typed = await vscode.window.showInputBox({
        title,
        prompt: "No checkpoints listed yet — type an exact checkpoint name",
      });
      return typed || undefined;
    }
    const picked = await vscode.window.showQuickPick(items, { title });
    return picked?.label;
  } catch {
    return vscode.window.showInputBox({ title });
  }
}

async function showResultDoc(title: string, result: QueryResult): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    content: JSON.stringify(
      { command: title, columns: result.columns, rowCount: result.rowCount, rows: result.rows },
      null,
      2,
    ),
    language: "json",
  });
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: true,
  });
}

async function runCreateCheckpoint(session: GraphForgeSession): Promise<void> {
  if (!(await ensureReady(session))) {
    return;
  }
  const name = await vscode.window.showInputBox({
    title: "GraphForge: Create Checkpoint…",
    prompt: "Checkpoint name",
    placeHolder: "before-rank",
  });
  if (!name) {
    return;
  }
  const description = await vscode.window.showInputBox({
    title: "GraphForge: Create Checkpoint — Description (optional)",
  });
  try {
    const result = await session.createCheckpoint(name, description || undefined);
    await showResultDoc("Create Checkpoint", result);
    void vscode.window.showInformationMessage(
      `GraphForge: checkpoint "${name}" created.`,
    );
  } catch (err) {
    reportEngineError("Create Checkpoint failed", err);
  }
}

async function runListCheckpoints(session: GraphForgeSession): Promise<void> {
  if (!(await ensureReady(session))) {
    return;
  }
  try {
    const result = await session.listCheckpoints(200);
    await showResultDoc("List Checkpoints", result);
    void vscode.window.showInformationMessage(
      `GraphForge: ${result.rowCount} checkpoint(s).`,
    );
  } catch (err) {
    reportEngineError("List Checkpoints failed", err);
  }
}

async function runOpenCheckpoint(session: GraphForgeSession): Promise<void> {
  if (!(await ensureReady(session))) {
    return;
  }
  const name = await pickCheckpointName(session, "GraphForge: Open Checkpoint");
  if (!name) {
    return;
  }
  try {
    const view = session.openCheckpointView(name);
    const cypher = await vscode.window.showInputBox({
      title: `GraphForge: Open Checkpoint "${name}" — read-only Cypher`,
      prompt: "This view is read-only; mutating Cypher will fail closed.",
      placeHolder: "MATCH (n) RETURN n LIMIT 25",
    });
    const doc = await vscode.workspace.openTextDocument({
      content: JSON.stringify(
        {
          checkpointUuid: view.checkpointUuid,
          generationUuid: view.generationUuid,
          note: "Read-only checkpoint view. Run again with a query to execute Cypher against it.",
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
        if (cypher?.trim()) {
          const buf = view.execute(cypher);
          const result = decodeTable(buf);
          await showResultDoc(`Open Checkpoint "${name}" — query`, result);
        }
  } catch (err) {
    reportEngineError("Open Checkpoint failed", err);
  }
}

async function runDiffCheckpoints(session: GraphForgeSession): Promise<void> {
  if (!(await ensureReady(session))) {
    return;
  }
  const from = await vscode.window.showInputBox({
    title: "GraphForge: Diff Checkpoints… — From",
    prompt: 'Checkpoint name, or "current"',
    value: "current",
  });
  if (!from) {
    return;
  }
  const to = await pickCheckpointName(session, "GraphForge: Diff Checkpoints… — To");
  if (!to) {
    return;
  }
  const scope = await vscode.window.showQuickPick(DIFF_SCOPES, {
    title: "GraphForge: Diff Checkpoints… — Scope",
    placeHolder: "summary",
  });
  if (!scope) {
    return;
  }
  const detail = await vscode.window.showQuickPick(DIFF_DETAILS, {
    title: "GraphForge: Diff Checkpoints… — Detail",
    placeHolder: "summary",
  });
  if (!detail) {
    return;
  }
  try {
    const result = await session.diffCheckpoints(from, to, scope, detail);
    await showResultDoc(`Diff ${from} → ${to} (${scope}/${detail})`, result);
    void vscode.window.showInformationMessage(
      `GraphForge: diff produced ${result.rowCount} row(s).`,
    );
  } catch (err) {
    reportEngineError("Diff Checkpoints failed", err);
  }
}

async function runDeleteCheckpoint(session: GraphForgeSession): Promise<void> {
  if (!(await ensureReady(session))) {
    return;
  }
  const name = await pickCheckpointName(session, "GraphForge: Delete Checkpoint…");
  if (!name) {
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Delete checkpoint "${name}"? This removes the active reference (underlying history depends on engine retention).`,
    { modal: true },
    "Delete",
  );
  if (confirm !== "Delete") {
    return;
  }
  try {
    const result = await session.deleteCheckpoint(name);
    await showResultDoc("Delete Checkpoint", result);
    void vscode.window.showInformationMessage(
      `GraphForge: checkpoint "${name}" deleted.`,
    );
  } catch (err) {
    reportEngineError("Delete Checkpoint failed", err);
  }
}

/**
 * Hard confirm per #9 AC: revert is a destructive local project mutation, so
 * a modal Yes/No is not enough — the analyst must retype the exact
 * checkpoint name before the engine call runs.
 */
async function runRevertToCheckpoint(session: GraphForgeSession): Promise<void> {
  if (!(await ensureReady(session))) {
    return;
  }
  const name = await pickCheckpointName(session, "GraphForge: Revert to Checkpoint…");
  if (!name) {
    return;
  }
  const reason = await vscode.window.showInputBox({
    title: "GraphForge: Revert to Checkpoint — Reason (required)",
    prompt: "Recorded with the reverted generation",
  });
  if (!reason) {
    return;
  }
  const typedName = await vscode.window.showInputBox({
    title: `Type "${name}" to confirm revert`,
    prompt:
      "This restores the checkpoint as a new committed generation and cannot be undone from here.",
    placeHolder: name,
  });
  if (typedName !== name) {
    void vscode.window.showWarningMessage(
      "GraphForge: revert cancelled — typed name did not match.",
    );
    return;
  }
  try {
    const result = await session.revertToCheckpoint(name, reason);
    await showResultDoc("Revert to Checkpoint", result);
    void vscode.window.showInformationMessage(
      `GraphForge: reverted to checkpoint "${name}".`,
    );
  } catch (err) {
    reportEngineError("Revert to Checkpoint failed", err);
  }
}
