import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import {
  CommandOutcome,
  ensureNodeRuntime,
  ensureProjectOrRecover,
  errorMessage,
  reportEngineError,
} from "./shared";

/** Every embedding-space command is Node-only; guard label reused across handlers. */
const EMBEDDING_FEATURE = "Embedding spaces";

/** Row shape accepted by `publishCallerEmbeddings`. */
export interface PublishCallerEmbeddingsInput {
  rows: Array<{ node: string; vector: number[] }>;
  dimensions: number;
  sourceProjection: Record<string, string>;
  replace?: boolean;
}

/**
 * Optional args (#36) so a coding agent can drive each embedding-space
 * command via `executeCommand` without any InputBox/QuickPick. Destructive
 * `deleteEmbeddingSpace` additionally requires `confirm: true` in args to
 * skip the human confirmation modal.
 */
export interface PublishCallerEmbeddingsArgs {
  name?: string;
  input?: PublishCallerEmbeddingsInput;
}
export interface BindEmbeddingSpaceAliasArgs {
  alias?: string;
  compatibilityId?: string;
  replace?: boolean;
}
export interface SetDefaultEmbeddingSpaceArgs {
  /** Space to make default; omit together with `clear: true` to clear it. */
  name?: string;
  clear?: boolean;
}
export interface DeleteEmbeddingSpaceArgs {
  name?: string;
  confirm?: boolean;
}
export interface InspectEmbeddingSpaceFreshnessArgs {
  /** Space to inspect; omit (with an args object present) for the default space. */
  name?: string;
}

/**
 * Embedding space commands (#10). The primary `Embedding Spaces` list is an
 * empty-state, not a failure, when none exist yet; publish/bind/default/
 * delete/freshness are separate flat Advanced commands that never require
 * an OpenRouter/provider key on this primary path.
 */
export function registerEmbeddingSpaces(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("graphforge.embeddingSpaces", () =>
      runListEmbeddingSpaces(session),
    ),

    vscode.commands.registerCommand(
      "graphforge.publishCallerEmbeddings",
      (args?: PublishCallerEmbeddingsArgs) =>
        runPublishCallerEmbeddings(session, args),
    ),

    vscode.commands.registerCommand(
      "graphforge.bindEmbeddingSpaceAlias",
      (args?: BindEmbeddingSpaceAliasArgs) =>
        runBindEmbeddingSpaceAlias(session, args),
    ),

    vscode.commands.registerCommand(
      "graphforge.setDefaultEmbeddingSpace",
      (args?: SetDefaultEmbeddingSpaceArgs) =>
        runSetDefaultEmbeddingSpace(session, args),
    ),

    vscode.commands.registerCommand(
      "graphforge.deleteEmbeddingSpace",
      (args?: DeleteEmbeddingSpaceArgs) => runDeleteEmbeddingSpace(session, args),
    ),

    vscode.commands.registerCommand(
      "graphforge.inspectEmbeddingSpaceFreshness",
      (args?: InspectEmbeddingSpaceFreshnessArgs) =>
        runInspectFreshness(session, args),
    ),
  );
}

async function showJson(title: string, value: unknown): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    content: JSON.stringify({ command: title, result: value ?? null }, null, 2),
    language: "json",
  });
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: true,
  });
}

function spaceName(space: unknown): string | undefined {
  if (space && typeof space === "object") {
    const rec = space as Record<string, unknown>;
    const name = rec.name ?? rec.alias ?? rec.compatibility_id ?? rec.compatibilityId;
    return name == null ? undefined : String(name);
  }
  return undefined;
}

interface EmbeddingSpacesPayload {
  embeddingSpaces: Array<{ space: unknown; freshness?: unknown }>;
  note?: string;
}

async function runListEmbeddingSpaces(
  session: GraphForgeSession,
): Promise<CommandOutcome<EmbeddingSpacesPayload>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  const wrongRuntime = await ensureNodeRuntime(session, EMBEDDING_FEATURE);
  if (wrongRuntime) {
    return wrongRuntime;
  }
  try {
    const spaces = session.embeddingSpaces();
    if (!spaces.length) {
      // Empty state, not a failure — #10 AC.
      const payload: EmbeddingSpacesPayload = {
        embeddingSpaces: [],
        note:
          "No embedding spaces yet. Use Advanced → GraphForge: Publish Caller Embeddings… " +
          "to create one (no provider/OpenRouter key required for caller-supplied vectors).",
      };
      const doc = await vscode.workspace.openTextDocument({
        content: JSON.stringify(payload, null, 2),
        language: "json",
      });
      await vscode.window.showTextDocument(doc, { preview: true });
      void vscode.window.showInformationMessage(
        "GraphForge: no embedding spaces yet — see Advanced → Publish Caller Embeddings…",
      );
      return payload;
    }
    const withFreshness = spaces.map((space) => {
      const name = spaceName(space);
      let freshness: unknown;
      try {
        freshness = session.inspectEmbeddingSpaceFreshness(name);
      } catch {
        freshness = undefined;
      }
      return { space, freshness };
    });
    await showJson("Embedding Spaces", withFreshness);
    void vscode.window.showInformationMessage(
      `GraphForge: ${spaces.length} embedding space(s).`,
    );
    return { embeddingSpaces: withFreshness };
  } catch (err) {
    return reportEngineError("Embedding Spaces failed", err);
  }
}

async function runPublishCallerEmbeddings(
  session: GraphForgeSession,
  args?: PublishCallerEmbeddingsArgs,
): Promise<CommandOutcome<{ name: string; compatibilityId: unknown }>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  const wrongRuntime = await ensureNodeRuntime(session, EMBEDDING_FEATURE);
  if (wrongRuntime) {
    return wrongRuntime;
  }
  const name =
    args?.name?.trim() ||
    (await vscode.window.showInputBox({
      title: "GraphForge: Publish Caller Embeddings — Space name",
      placeHolder: "my-caller-space",
    }));
  if (!name) {
    return { cancelled: true };
  }

  let input: PublishCallerEmbeddingsInput;
  if (args?.input) {
    // Args path: the caller supplied the full payload — no editor round-trip.
    input = args.input;
  } else {
    const template = JSON.stringify(
      {
        dimensions: 3,
        sourceProjection: { recipe: "manual-v1" },
        rows: [
          { node: "<node-uuid>", vector: [0.1, 0.2, 0.3] },
        ],
      },
      null,
      2,
    );
    const doc = await vscode.workspace.openTextDocument({
      content:
        `// GraphForge: Publish Caller Embeddings — edit the JSON below, save, then run\n` +
        `// "GraphForge: Publish Caller Embeddings (Submit Active Editor)" — left as a\n` +
        `// documented two-step flow so large row arrays are comfortable to edit.\n${template}`,
      language: "jsonc",
    });
    await vscode.window.showTextDocument(doc, { preview: false });
    const proceed = await vscode.window.showInformationMessage(
      "Edit the JSON in the opened editor, then choose Publish when ready.",
      "Publish",
      "Cancel",
    );
    if (proceed !== "Publish") {
      return { cancelled: true };
    }
    try {
      const raw = doc.getText().replace(/^\/\/.*$/gm, "");
      input = JSON.parse(raw);
    } catch (err) {
      const message = `could not parse embedding publish JSON — ${errorMessage(err)}`;
      void vscode.window.showErrorMessage(`GraphForge: ${message}`);
      return { error: message };
    }
  }
  try {
    const compatibilityId = session.publishCallerEmbeddings(name, input);
    await showJson("Publish Caller Embeddings", { name, compatibilityId });
    void vscode.window.showInformationMessage(
      `GraphForge: published embedding space "${name}" (${compatibilityId}).`,
    );
    return { name, compatibilityId };
  } catch (err) {
    return reportEngineError("Publish Caller Embeddings failed", err);
  }
}

async function pickSpaceName(session: GraphForgeSession): Promise<string | undefined> {
  try {
    const spaces = session.embeddingSpaces();
    const names = spaces.map(spaceName).filter((n): n is string => Boolean(n));
    if (!names.length) {
      return vscode.window.showInputBox({ title: "GraphForge: Embedding space name" });
    }
    return vscode.window.showQuickPick(names, {
      title: "GraphForge: Embedding space",
    });
  } catch {
    return vscode.window.showInputBox({ title: "GraphForge: Embedding space name" });
  }
}

async function runBindEmbeddingSpaceAlias(
  session: GraphForgeSession,
  args?: BindEmbeddingSpaceAliasArgs,
): Promise<CommandOutcome<{ alias: string; compatibilityId: string; result: unknown }>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  const wrongRuntime = await ensureNodeRuntime(session, EMBEDDING_FEATURE);
  if (wrongRuntime) {
    return wrongRuntime;
  }
  const alias =
    args?.alias?.trim() ||
    (await vscode.window.showInputBox({
      title: "GraphForge: Bind Embedding Space Alias — Alias name",
    }));
  if (!alias) {
    return { cancelled: true };
  }
  const compatibilityId =
    args?.compatibilityId?.trim() ||
    (await vscode.window.showInputBox({
      title: "GraphForge: Bind Embedding Space Alias — Compatibility ID",
      prompt: "From Publish Caller Embeddings / Embedding Spaces output",
    }));
  if (!compatibilityId) {
    return { cancelled: true };
  }
  let replace: boolean;
  if (args && typeof args.replace === "boolean") {
    replace = args.replace;
  } else {
    const picked = await vscode.window.showQuickPick(["No", "Yes"], {
      title: "GraphForge: Replace existing alias if occupied?",
    });
    if (picked === undefined) {
      return { cancelled: true };
    }
    replace = picked === "Yes";
  }
  try {
    const result = session.bindEmbeddingSpaceAlias(alias, compatibilityId, replace);
    await showJson("Bind Embedding Space Alias", result);
    void vscode.window.showInformationMessage(
      `GraphForge: alias "${alias}" bound.`,
    );
    return { alias, compatibilityId, result: result ?? null };
  } catch (err) {
    return reportEngineError("Bind Embedding Space Alias failed", err);
  }
}

async function runSetDefaultEmbeddingSpace(
  session: GraphForgeSession,
  args?: SetDefaultEmbeddingSpaceArgs,
): Promise<CommandOutcome<{ name?: string; result: unknown }>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  const wrongRuntime = await ensureNodeRuntime(session, EMBEDDING_FEATURE);
  if (wrongRuntime) {
    return wrongRuntime;
  }
  let name: string | undefined;
  if (args) {
    name = args.clear ? undefined : args.name?.trim() || undefined;
    if (!name && !args.clear) {
      return { error: "Provide { name } to set, or { clear: true } to clear the default." };
    }
  } else {
    const picked = await pickSpaceName(session);
    if (picked === undefined) {
      return { cancelled: true };
    }
    name = picked || undefined;
  }
  try {
    const result = session.setDefaultEmbeddingSpace(name);
    await showJson("Set Default Embedding Space", result);
    void vscode.window.showInformationMessage(
      name
        ? `GraphForge: default embedding space set to "${name}".`
        : "GraphForge: default embedding space cleared.",
    );
    return { name, result: result ?? null };
  } catch (err) {
    return reportEngineError("Set Default Embedding Space failed", err);
  }
}

async function runDeleteEmbeddingSpace(
  session: GraphForgeSession,
  args?: DeleteEmbeddingSpaceArgs,
): Promise<CommandOutcome<{ name: string; removed: boolean }>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  const wrongRuntime = await ensureNodeRuntime(session, EMBEDDING_FEATURE);
  if (wrongRuntime) {
    return wrongRuntime;
  }
  const name = args?.name?.trim() || (await pickSpaceName(session));
  if (!name) {
    return { cancelled: true };
  }
  // Destructive: agents must pass `confirm: true`; humans get the modal.
  if (args?.confirm !== true) {
    const confirm = await vscode.window.showWarningMessage(
      `Delete embedding space "${name}"? This removes the compatibility lineage and cannot be undone.`,
      { modal: true },
      "Delete",
    );
    if (confirm !== "Delete") {
      return { cancelled: true };
    }
  }
  try {
    const removed = session.deleteEmbeddingSpace(name);
    await showJson("Delete Embedding Space", { name, removed });
    void vscode.window.showInformationMessage(
      `GraphForge: embedding space "${name}" ${removed ? "deleted" : "was not found"}.`,
    );
    return { name, removed };
  } catch (err) {
    return reportEngineError("Delete Embedding Space failed", err);
  }
}

async function runInspectFreshness(
  session: GraphForgeSession,
  args?: InspectEmbeddingSpaceFreshnessArgs,
): Promise<CommandOutcome<{ name?: string; freshness: unknown }>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  const wrongRuntime = await ensureNodeRuntime(session, EMBEDDING_FEATURE);
  if (wrongRuntime) {
    return wrongRuntime;
  }
  // Args object present (even empty) skips the picker: `{}` means "default space".
  const name = args ? args.name?.trim() || undefined : await pickSpaceName(session);
  try {
    const freshness = session.inspectEmbeddingSpaceFreshness(name || undefined);
    await showJson("Inspect Embedding Space Freshness", freshness);
    return { name: name || undefined, freshness: freshness ?? null };
  } catch (err) {
    return reportEngineError("Inspect Embedding Space Freshness failed", err);
  }
}
