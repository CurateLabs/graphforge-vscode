import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import { UnsupportedByBindingError } from "../session/graphForgeSession";
import { errorMessage } from "./shared";

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
    vscode.commands.registerCommand("graphforge.embeddingSpaces", async () => {
      await runListEmbeddingSpaces(session);
    }),

    vscode.commands.registerCommand(
      "graphforge.publishCallerEmbeddings",
      async () => {
        await runPublishCallerEmbeddings(session);
      },
    ),

    vscode.commands.registerCommand(
      "graphforge.bindEmbeddingSpaceAlias",
      async () => {
        await runBindEmbeddingSpaceAlias(session);
      },
    ),

    vscode.commands.registerCommand(
      "graphforge.setDefaultEmbeddingSpace",
      async () => {
        await runSetDefaultEmbeddingSpace(session);
      },
    ),

    vscode.commands.registerCommand(
      "graphforge.deleteEmbeddingSpace",
      async () => {
        await runDeleteEmbeddingSpace(session);
      },
    ),

    vscode.commands.registerCommand(
      "graphforge.inspectEmbeddingSpaceFreshness",
      async () => {
        await runInspectFreshness(session);
      },
    ),
  );
}

async function ensureReady(session: GraphForgeSession): Promise<boolean> {
  try {
    await session.ensureProject();
    return true;
  } catch (err) {
    void vscode.window.showErrorMessage(errorMessage(err));
    return false;
  }
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

async function reportError(err: unknown): Promise<void> {
  if (err instanceof UnsupportedByBindingError) {
    void vscode.window.showWarningMessage(`GraphForge: ${err.message}`);
    return;
  }
  void vscode.window.showErrorMessage(`GraphForge: ${errorMessage(err)}`);
}

function spaceName(space: unknown): string | undefined {
  if (space && typeof space === "object") {
    const rec = space as Record<string, unknown>;
    const name = rec.name ?? rec.alias ?? rec.compatibility_id ?? rec.compatibilityId;
    return name == null ? undefined : String(name);
  }
  return undefined;
}

async function runListEmbeddingSpaces(session: GraphForgeSession): Promise<void> {
  if (!(await ensureReady(session))) {
    return;
  }
  try {
    const spaces = session.embeddingSpaces();
    if (!spaces.length) {
      // Empty state, not a failure — #10 AC.
      const doc = await vscode.workspace.openTextDocument({
        content: JSON.stringify(
          {
            embeddingSpaces: [],
            note:
              "No embedding spaces yet. Use Advanced → GraphForge: Publish Caller Embeddings… " +
              "to create one (no provider/OpenRouter key required for caller-supplied vectors).",
          },
          null,
          2,
        ),
        language: "json",
      });
      await vscode.window.showTextDocument(doc, { preview: true });
      void vscode.window.showInformationMessage(
        "GraphForge: no embedding spaces yet — see Advanced → Publish Caller Embeddings…",
      );
      return;
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
  } catch (err) {
    await reportError(err);
  }
}

async function runPublishCallerEmbeddings(session: GraphForgeSession): Promise<void> {
  if (!(await ensureReady(session))) {
    return;
  }
  const name = await vscode.window.showInputBox({
    title: "GraphForge: Publish Caller Embeddings — Space name",
    placeHolder: "my-caller-space",
  });
  if (!name) {
    return;
  }
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
    return;
  }
  let input: {
    rows: Array<{ node: string; vector: number[] }>;
    dimensions: number;
    sourceProjection: Record<string, string>;
    replace?: boolean;
  };
  try {
    const raw = doc.getText().replace(/^\/\/.*$/gm, "");
    input = JSON.parse(raw);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `GraphForge: could not parse embedding publish JSON — ${errorMessage(err)}`,
    );
    return;
  }
  try {
    const compatibilityId = session.publishCallerEmbeddings(name, input);
    await showJson("Publish Caller Embeddings", { name, compatibilityId });
    void vscode.window.showInformationMessage(
      `GraphForge: published embedding space "${name}" (${compatibilityId}).`,
    );
  } catch (err) {
    await reportError(err);
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

async function runBindEmbeddingSpaceAlias(session: GraphForgeSession): Promise<void> {
  if (!(await ensureReady(session))) {
    return;
  }
  const alias = await vscode.window.showInputBox({
    title: "GraphForge: Bind Embedding Space Alias — Alias name",
  });
  if (!alias) {
    return;
  }
  const compatibilityId = await vscode.window.showInputBox({
    title: "GraphForge: Bind Embedding Space Alias — Compatibility ID",
    prompt: "From Publish Caller Embeddings / Embedding Spaces output",
  });
  if (!compatibilityId) {
    return;
  }
  const replace = await vscode.window.showQuickPick(["No", "Yes"], {
    title: "GraphForge: Replace existing alias if occupied?",
  });
  if (replace === undefined) {
    return;
  }
  try {
    const result = session.bindEmbeddingSpaceAlias(
      alias,
      compatibilityId,
      replace === "Yes",
    );
    await showJson("Bind Embedding Space Alias", result);
    void vscode.window.showInformationMessage(
      `GraphForge: alias "${alias}" bound.`,
    );
  } catch (err) {
    await reportError(err);
  }
}

async function runSetDefaultEmbeddingSpace(session: GraphForgeSession): Promise<void> {
  if (!(await ensureReady(session))) {
    return;
  }
  const name = await pickSpaceName(session);
  if (name === undefined) {
    return;
  }
  try {
    const result = session.setDefaultEmbeddingSpace(name || undefined);
    await showJson("Set Default Embedding Space", result);
    void vscode.window.showInformationMessage(
      name
        ? `GraphForge: default embedding space set to "${name}".`
        : "GraphForge: default embedding space cleared.",
    );
  } catch (err) {
    await reportError(err);
  }
}

async function runDeleteEmbeddingSpace(session: GraphForgeSession): Promise<void> {
  if (!(await ensureReady(session))) {
    return;
  }
  const name = await pickSpaceName(session);
  if (!name) {
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Delete embedding space "${name}"? This removes the compatibility lineage and cannot be undone.`,
    { modal: true },
    "Delete",
  );
  if (confirm !== "Delete") {
    return;
  }
  try {
    const removed = session.deleteEmbeddingSpace(name);
    await showJson("Delete Embedding Space", { name, removed });
    void vscode.window.showInformationMessage(
      `GraphForge: embedding space "${name}" ${removed ? "deleted" : "was not found"}.`,
    );
  } catch (err) {
    await reportError(err);
  }
}

async function runInspectFreshness(session: GraphForgeSession): Promise<void> {
  if (!(await ensureReady(session))) {
    return;
  }
  const name = await pickSpaceName(session);
  try {
    const freshness = session.inspectEmbeddingSpaceFreshness(name || undefined);
    await showJson("Inspect Embedding Space Freshness", freshness);
  } catch (err) {
    await reportError(err);
  }
}
