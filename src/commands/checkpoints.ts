import * as vscode from "vscode";
import { decodeTable } from "../session/arrowCodec";
import type { GraphForgeSession } from "../session/graphForgeSession";
import type { QueryResult, TableRow } from "../session/types";
import { DIFF_DETAIL_OPTIONS, DIFF_SCOPE_OPTIONS } from "./pickerCopy";
import {
  CommandOutcome,
  ensureProjectOrRecover,
  reportEngineError,
} from "./shared";

/**
 * Optional args (#36) so a coding agent can drive each checkpoint command via
 * `executeCommand` without any InputBox/QuickPick. Destructive commands
 * (`deleteCheckpoint`, `revertToCheckpoint`) additionally require
 * `confirm: true` in args to skip their human confirmation step.
 */
export interface CreateCheckpointArgs {
  name?: string;
  description?: string;
}
export interface ListCheckpointsArgs {
  limit?: number;
}
export interface OpenCheckpointArgs {
  name?: string;
  cypher?: string;
}
export interface DiffCheckpointsArgs {
  from?: string;
  to?: string;
  scope?: string;
  detail?: string;
}
export interface DeleteCheckpointArgs {
  name?: string;
  confirm?: boolean;
}
export interface RevertToCheckpointArgs {
  name?: string;
  reason?: string;
  confirm?: boolean;
}

/**
 * Checkpoint commands (#9) — flat palette entries, no cascading checkpoint
 * wizard. `Revert to Checkpoint…` requires the analyst to type the exact
 * checkpoint name back as a hard confirmation before the destructive engine
 * call runs (agents pass `{ name, reason, confirm: true }` instead).
 */
export function registerCheckpoints(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "graphforge.createCheckpoint",
      (args?: CreateCheckpointArgs) => runCreateCheckpoint(session, args),
    ),

    vscode.commands.registerCommand(
      "graphforge.listCheckpoints",
      (args?: ListCheckpointsArgs) => runListCheckpoints(session, args),
    ),

    vscode.commands.registerCommand(
      "graphforge.openCheckpoint",
      (args?: OpenCheckpointArgs) => runOpenCheckpoint(session, args),
    ),

    vscode.commands.registerCommand(
      "graphforge.diffCheckpoints",
      (args?: DiffCheckpointsArgs) => runDiffCheckpoints(session, args),
    ),

    vscode.commands.registerCommand(
      "graphforge.deleteCheckpoint",
      (args?: DeleteCheckpointArgs) => runDeleteCheckpoint(session, args),
    ),

    vscode.commands.registerCommand(
      "graphforge.revertToCheckpoint",
      (args?: RevertToCheckpointArgs) => runRevertToCheckpoint(session, args),
    ),
  );
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

async function runCreateCheckpoint(
  session: GraphForgeSession,
  args?: CreateCheckpointArgs,
): Promise<CommandOutcome<QueryResult>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  const name =
    args?.name?.trim() ||
    (await vscode.window.showInputBox({
      title: "GraphForge: Create Checkpoint…",
      prompt: "Checkpoint name",
      placeHolder: "before-rank",
    }));
  if (!name) {
    return { cancelled: true };
  }
  const description =
    args?.description ??
    (await vscode.window.showInputBox({
      title: "GraphForge: Create Checkpoint — Description (optional)",
    }));
  try {
    const result = await session.createCheckpoint(name, description || undefined);
    await showResultDoc("Create Checkpoint", result);
    void vscode.window.showInformationMessage(
      `GraphForge: checkpoint "${name}" created.`,
    );
    return result;
  } catch (err) {
    return reportEngineError("Create Checkpoint failed", err);
  }
}

async function runListCheckpoints(
  session: GraphForgeSession,
  args?: ListCheckpointsArgs,
): Promise<CommandOutcome<QueryResult>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  try {
    const result = await session.listCheckpoints(args?.limit ?? 200);
    await showResultDoc("List Checkpoints", result);
    void vscode.window.showInformationMessage(
      `GraphForge: ${result.rowCount} checkpoint(s).`,
    );
    return result;
  } catch (err) {
    return reportEngineError("List Checkpoints failed", err);
  }
}

interface OpenCheckpointPayload {
  checkpointUuid: string;
  generationUuid: string;
  query?: QueryResult;
}

async function runOpenCheckpoint(
  session: GraphForgeSession,
  args?: OpenCheckpointArgs,
): Promise<CommandOutcome<OpenCheckpointPayload>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  const name =
    args?.name?.trim() ||
    (await pickCheckpointName(session, "GraphForge: Open Checkpoint"));
  if (!name) {
    return { cancelled: true };
  }
  try {
    const view = session.openCheckpointView(name);
    const cypher =
      args && "cypher" in args
        ? args.cypher
        : await vscode.window.showInputBox({
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
    let query: QueryResult | undefined;
    if (cypher?.trim()) {
      const buf = view.execute(cypher);
      query = decodeTable(buf);
      await showResultDoc(`Open Checkpoint "${name}" — query`, query);
    }
    return {
      checkpointUuid: view.checkpointUuid,
      generationUuid: view.generationUuid,
      query,
    };
  } catch (err) {
    return reportEngineError("Open Checkpoint failed", err);
  }
}

async function runDiffCheckpoints(
  session: GraphForgeSession,
  args?: DiffCheckpointsArgs,
): Promise<CommandOutcome<QueryResult>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  const from =
    args?.from?.trim() ||
    (await vscode.window.showInputBox({
      title: "GraphForge: Diff Checkpoints… — From",
      prompt: 'Checkpoint name, or "current"',
      value: "current",
    }));
  if (!from) {
    return { cancelled: true };
  }
  const to =
    args?.to?.trim() ||
    (await pickCheckpointName(session, "GraphForge: Diff Checkpoints… — To"));
  if (!to) {
    return { cancelled: true };
  }
  const scope =
    args?.scope?.trim() ||
    (
      await vscode.window.showQuickPick([...DIFF_SCOPE_OPTIONS], {
        title: "GraphForge: Diff Checkpoints… — Scope",
        placeHolder: "summary",
      })
    )?.label;
  if (!scope) {
    return { cancelled: true };
  }
  const detail =
    args?.detail?.trim() ||
    (
      await vscode.window.showQuickPick([...DIFF_DETAIL_OPTIONS], {
        title: "GraphForge: Diff Checkpoints… — Detail",
        placeHolder: "summary",
      })
    )?.label;
  if (!detail) {
    return { cancelled: true };
  }
  try {
    const result = await session.diffCheckpoints(from, to, scope, detail);
    await showResultDoc(`Diff ${from} → ${to} (${scope}/${detail})`, result);
    void vscode.window.showInformationMessage(
      `GraphForge: diff produced ${result.rowCount} row(s).`,
    );
    return result;
  } catch (err) {
    return reportEngineError("Diff Checkpoints failed", err);
  }
}

async function runDeleteCheckpoint(
  session: GraphForgeSession,
  args?: DeleteCheckpointArgs,
): Promise<CommandOutcome<QueryResult>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  const name =
    args?.name?.trim() ||
    (await pickCheckpointName(session, "GraphForge: Delete Checkpoint…"));
  if (!name) {
    return { cancelled: true };
  }
  // Destructive: agents must pass `confirm: true`; humans get the modal.
  if (args?.confirm !== true) {
    const confirm = await vscode.window.showWarningMessage(
      `Delete checkpoint "${name}"? This removes the active reference (underlying history depends on engine retention).`,
      { modal: true },
      "Delete",
    );
    if (confirm !== "Delete") {
      return { cancelled: true };
    }
  }
  try {
    const result = await session.deleteCheckpoint(name);
    await showResultDoc("Delete Checkpoint", result);
    void vscode.window.showInformationMessage(
      `GraphForge: checkpoint "${name}" deleted.`,
    );
    return result;
  } catch (err) {
    return reportEngineError("Delete Checkpoint failed", err);
  }
}

/**
 * Hard confirm per #9 AC: revert is a destructive local project mutation, so
 * a modal Yes/No is not enough — the analyst must retype the exact
 * checkpoint name before the engine call runs. An agent bypasses the retype
 * step only by passing all of `{ name, reason, confirm: true }`.
 */
async function runRevertToCheckpoint(
  session: GraphForgeSession,
  args?: RevertToCheckpointArgs,
): Promise<CommandOutcome<QueryResult>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  const name =
    args?.name?.trim() ||
    (await pickCheckpointName(session, "GraphForge: Revert to Checkpoint…"));
  if (!name) {
    return { cancelled: true };
  }
  const reason =
    args?.reason?.trim() ||
    (await vscode.window.showInputBox({
      title: "GraphForge: Revert to Checkpoint — Reason (required)",
      prompt: "Recorded with the reverted generation",
    }));
  if (!reason) {
    return { cancelled: true };
  }
  if (args?.confirm !== true) {
    // #40: point at the safest pre-check (Diff Checkpoints…) without adding a
    // blocking step — the retype-to-confirm gate itself is unchanged.
    const typedName = await vscode.window.showInputBox({
      title: `Type "${name}" to confirm revert`,
      prompt:
        "This restores the checkpoint as a new committed generation and cannot be undone from here. " +
        'Not sure what will change? Press Escape and run "GraphForge: Diff Checkpoints…" first.',
      placeHolder: name,
    });
    if (typedName !== name) {
      void vscode.window.showWarningMessage(
        "GraphForge: revert cancelled — typed name did not match.",
      );
      return { cancelled: true };
    }
  }
  try {
    const result = await session.revertToCheckpoint(name, reason);
    await showResultDoc("Revert to Checkpoint", result);
    void vscode.window.showInformationMessage(
      `GraphForge: reverted to checkpoint "${name}".`,
    );
    return result;
  } catch (err) {
    return reportEngineError("Revert to Checkpoint failed", err);
  }
}
