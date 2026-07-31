import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import { ANALYZE_BY, AnalystVerb, CLUSTER_BY, QueryResult, RANK_BY, SIMILAR_BY, WriteMode, WRITE_MODES } from "../session/types";
import { WRITE_MODE_OPTIONS } from "./pickerCopy";
import {
  CommandOutcome,
  ensureProjectOrRecover,
  errorMessage,
  reportEngineError,
} from "./shared";

const COMPOSITE_DOCS_URL =
  "https://docs.graphforge.sh/reference/composite-transactions";

const DESCRIPTOR_VERBS: Array<Exclude<AnalystVerb, "find" | "paths">> = [
  "rank",
  "cluster",
  "analyze",
  "similar",
];
const DESCRIPTOR_VERB_BY: Record<
  Exclude<AnalystVerb, "find" | "paths">,
  readonly string[]
> = {
  rank: RANK_BY,
  cluster: CLUSTER_BY,
  analyze: ANALYZE_BY,
  similar: SIMILAR_BY,
};

/**
 * Optional args (#36) so a coding agent can drive each power command via
 * `executeCommand` without any InputBox/QuickPick. Commands that mutate the
 * project or engine handle (`enableCapability`, `openWithWriteMode`,
 * `publishCompositeTransaction`) additionally require `confirm: true` in
 * args to skip their human confirmation step.
 */
export interface EnableCapabilityArgs {
  capabilityId?: string;
  version?: number;
  confirm?: boolean;
}
export interface OpenWithWriteModeArgs {
  mode?: WriteMode;
  confirm?: boolean;
}
export interface ExportInvocationDescriptorArgs {
  verb?: Exclude<AnalystVerb, "find" | "paths">;
  label?: string;
  by?: string;
  /** Invoke the descriptor immediately after export (skips the toast prompt). */
  invoke?: boolean;
}
export interface ListAlgorithmRunsArgs {
  algorithm?: string;
  limit?: number;
}
export interface PublishCompositeTransactionArgs {
  /** Full composite transaction request; bypasses the JSON editor flow. */
  request?: unknown;
  confirm?: boolean;
}

/**
 * Power / engineer commands (#11) — write mode, capabilities, invocation
 * descriptors, algorithm runs, and the expert-only composite publish. Every
 * destructive or expert path here requires an explicit confirm; composite
 * publish is Advanced-only and links to engine docs rather than offering a
 * visual builder.
 */
export function registerPower(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "graphforge.enableCapability",
      (args?: EnableCapabilityArgs) => runEnableCapability(session, args),
    ),

    vscode.commands.registerCommand(
      "graphforge.openWithWriteMode",
      (args?: OpenWithWriteModeArgs) => runOpenWithWriteMode(session, args),
    ),

    vscode.commands.registerCommand(
      "graphforge.exportInvocationDescriptor",
      (args?: ExportInvocationDescriptorArgs) =>
        runExportInvocationDescriptor(session, args),
    ),

    vscode.commands.registerCommand(
      "graphforge.listAlgorithmRuns",
      (args?: ListAlgorithmRunsArgs) => runListAlgorithmRuns(session, args),
    ),

    vscode.commands.registerCommand(
      "graphforge.publishCompositeTransaction",
      (args?: PublishCompositeTransactionArgs) =>
        runPublishCompositeTransaction(session, args),
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

async function runEnableCapability(
  session: GraphForgeSession,
  args?: EnableCapabilityArgs,
): Promise<CommandOutcome<QueryResult>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  const capabilityId =
    args?.capabilityId?.trim() ||
    (await vscode.window.showInputBox({
      title: "GraphForge: Enable Capability… — Capability ID",
      prompt: "Registered lowercase capability ID",
    }));
  if (!capabilityId) {
    return { cancelled: true };
  }
  let version: number;
  if (typeof args?.version === "number") {
    version = args.version;
  } else {
    const versionRaw = await vscode.window.showInputBox({
      title: "GraphForge: Enable Capability… — Capability version",
      value: "1",
    });
    if (versionRaw === undefined) {
      return { cancelled: true };
    }
    version = Number(versionRaw);
  }
  if (!Number.isFinite(version)) {
    const message = "capability version must be a number.";
    void vscode.window.showErrorMessage(`GraphForge: ${message}`);
    return { error: message };
  }
  // Manifest mutation: agents must pass `confirm: true`; humans get the modal.
  // #40: plain workbench voice, same facts — applied in one step (atomic),
  // and not undoable from here.
  if (args?.confirm !== true) {
    const confirm = await vscode.window.showWarningMessage(
      `Enable capability "${capabilityId}" v${version}? This changes what your project can do — ` +
        `it is applied in one step and can't be undone from here.`,
      { modal: true },
      "Enable",
    );
    if (confirm !== "Enable") {
      return { cancelled: true };
    }
  }
  try {
    const result = await session.enableCapability(capabilityId, version);
    await showJson("Enable Capability", result);
    void vscode.window.showInformationMessage(
      `GraphForge: capability "${capabilityId}" v${version} enabled.`,
    );
    return result;
  } catch (err) {
    return reportEngineError("Enable Capability failed", err);
  }
}

/**
 * Advanced reopen-with-mode (#11 open question resolved conservatively):
 * confirm before reopening, since it drops and recreates the native engine
 * handle even though it does not mutate committed project data.
 */
async function runOpenWithWriteMode(
  session: GraphForgeSession,
  args?: OpenWithWriteModeArgs,
): Promise<CommandOutcome<{ ok: true; writeMode: WriteMode }>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  const mode =
    args?.mode ??
    (
      await vscode.window.showQuickPick([...WRITE_MODE_OPTIONS], {
        title: "GraphForge: Open with Write Mode…",
        placeHolder: session.writeMode,
      })
    )?.label;
  if (!mode) {
    return { cancelled: true };
  }
  if (!WRITE_MODES.includes(mode)) {
    return { error: `unknown write mode "${mode}" — expected one of: ${WRITE_MODES.join(", ")}` };
  }
  if (mode === session.writeMode) {
    void vscode.window.showInformationMessage(
      `GraphForge: already open in ${mode}.`,
    );
    return { ok: true, writeMode: mode };
  }
  if (args?.confirm !== true) {
    const confirm = await vscode.window.showWarningMessage(
      `Reopen the active project with write mode "${mode}" (currently "${session.writeMode}")?`,
      { modal: true },
      "Reopen",
    );
    if (confirm !== "Reopen") {
      return { cancelled: true };
    }
  }
  try {
    await session.reopenWithWriteMode(mode);
    void vscode.window.showInformationMessage(
      `GraphForge: reopened with write mode "${mode}".`,
    );
    return { ok: true, writeMode: mode };
  } catch (err) {
    return reportEngineError("Open with Write Mode failed", err);
  }
}

interface InvocationDescriptorPayload {
  verb: string;
  algorithm?: string;
  fingerprint: string;
  projectionFingerprint?: string;
  canonicalBytesBase64: string;
  invocation?: { columns: string[]; rowCount: number; rows: QueryResult["rows"] };
}

/**
 * Export a prepared invocation descriptor's fingerprint/canonical bytes to an
 * editor buffer (#11 AC — descriptor export works for at least one verb
 * path, e.g. rank). Uses the same label/by pickers as the analyst verbs.
 */
async function runExportInvocationDescriptor(
  session: GraphForgeSession,
  args?: ExportInvocationDescriptorArgs,
): Promise<CommandOutcome<InvocationDescriptorPayload>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  const verb =
    args?.verb ??
    ((await vscode.window.showQuickPick(DESCRIPTOR_VERBS, {
      title: "GraphForge: Export Invocation Descriptor — Verb",
      placeHolder: "rank",
    })) as Exclude<AnalystVerb, "find" | "paths"> | undefined);
  if (!verb) {
    return { cancelled: true };
  }
  if (!DESCRIPTOR_VERBS.includes(verb)) {
    return { error: `unknown descriptor verb "${verb}" — expected one of: ${DESCRIPTOR_VERBS.join(", ")}` };
  }
  let label = args?.label?.trim();
  if (!label) {
    const labels = await session.labels();
    label = await vscode.window.showQuickPick(
      labels.length ? labels : ["Person"],
      { title: "GraphForge: Export Invocation Descriptor — Label" },
    );
  }
  if (!label) {
    return { cancelled: true };
  }
  const catalog = DESCRIPTOR_VERB_BY[verb];
  const by =
    args?.by?.trim() ||
    (await vscode.window.showQuickPick([...catalog], {
      title: "GraphForge: Export Invocation Descriptor — Algorithm (by)",
      placeHolder: catalog[0],
    }));
  if (!by) {
    return { cancelled: true };
  }
  try {
    const descriptor = session.prepareInvocation(verb, { label, by });
    const payload: InvocationDescriptorPayload = {
      verb: descriptor.verb,
      algorithm: descriptor.algorithm,
      fingerprint: descriptor.fingerprint,
      projectionFingerprint: descriptor.projectionFingerprint,
      canonicalBytesBase64: descriptor.canonicalBytes.toString("base64"),
    };
    const doc = await vscode.workspace.openTextDocument({
      content: JSON.stringify(payload, null, 2),
      language: "json",
    });
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true,
    });
    let invoke: boolean;
    if (typeof args?.invoke === "boolean") {
      invoke = args.invoke;
    } else {
      const choice = await vscode.window.showInformationMessage(
        `GraphForge: descriptor exported (fingerprint ${descriptor.fingerprint.slice(0, 12)}…). Invoke it now?`,
        "Invoke",
      );
      invoke = Boolean(choice);
    }
    if (invoke) {
      const result = session.invokeDescriptor(descriptor);
      payload.invocation = {
        columns: result.columns,
        rowCount: result.rowCount,
        rows: result.rows,
      };
      await showJson(`Invoke Descriptor (${verb})`, payload.invocation);
    }
    return payload;
  } catch (err) {
    return reportEngineError("Export Invocation Descriptor failed", err);
  }
}

async function runListAlgorithmRuns(
  session: GraphForgeSession,
  args?: ListAlgorithmRunsArgs,
): Promise<CommandOutcome<QueryResult>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  try {
    const result = await session.listAlgorithmRuns(
      args?.algorithm,
      args?.limit ?? 100,
    );
    await showJson("List Algorithm Runs", {
      columns: result.columns,
      rowCount: result.rowCount,
      rows: result.rows,
    });
    return result;
  } catch (err) {
    return reportEngineError("List Algorithm Runs failed", err);
  }
}

/**
 * Composite publish (#11) is deliberately Advanced-only: no visual builder,
 * just a JSON editor buffer + a link to engine docs, matching the tracker's
 * "no cascading menu mazes" doctrine for expert-only surfaces. An agent
 * bypasses the editor flow by passing `{ request, confirm: true }`.
 */
async function runPublishCompositeTransaction(
  session: GraphForgeSession,
  args?: PublishCompositeTransactionArgs,
): Promise<CommandOutcome<QueryResult>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }

  let request: unknown;
  if (args?.request !== undefined) {
    if (args.confirm !== true) {
      return {
        error:
          "publishCompositeTransaction is a single-shot project mutation — pass { request, confirm: true } to publish programmatically.",
      };
    }
    request = args.request;
  } else {
    const openDocs = await vscode.window.showWarningMessage(
      "GraphForge: Publish Composite Transaction is an expert-only, single-shot " +
        "graph + knowledge write. There is no visual builder — see the engine's " +
        "composite transaction contract docs before proceeding.",
      "Open Docs",
      "Continue",
      "Cancel",
    );
    if (openDocs === "Open Docs") {
      void vscode.env.openExternal(vscode.Uri.parse(COMPOSITE_DOCS_URL));
    }
    if (openDocs !== "Continue" && openDocs !== "Open Docs") {
      return { cancelled: true };
    }

    const doc = await vscode.workspace.openTextDocument({
      content:
        `// GraphForge: Publish Composite Transaction (expert / Advanced-only)\n` +
        `// Docs: ${COMPOSITE_DOCS_URL}\n` +
        `// Edit the JSON request below, save, then confirm in the follow-up prompt.\n` +
        `{\n  "operationUuid": "",\n  "nodes": [],\n  "edges": [],\n  "knowledge": {}\n}\n`,
      language: "jsonc",
    });
    await vscode.window.showTextDocument(doc, { preview: false });

    const proceed = await vscode.window.showWarningMessage(
      "Publish the composite transaction from the opened editor now? This is a single-shot project mutation.",
      { modal: true },
      "Publish",
    );
    if (proceed !== "Publish") {
      return { cancelled: true };
    }

    try {
      const raw = doc.getText().replace(/^\/\/.*$/gm, "");
      request = JSON.parse(raw);
    } catch (err) {
      const message = `could not parse composite transaction JSON — ${errorMessage(err)}`;
      void vscode.window.showErrorMessage(`GraphForge: ${message}`);
      return { error: message };
    }
  }
  try {
    const result = session.publishCompositeTransaction(request);
    await showJson("Publish Composite Transaction", {
      columns: result.columns,
      rowCount: result.rowCount,
      rows: result.rows,
    });
    void vscode.window.showInformationMessage(
      "GraphForge: composite transaction published.",
    );
    return result;
  } catch (err) {
    return reportEngineError("Publish Composite Transaction failed", err);
  }
}
