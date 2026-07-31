import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import { ANALYZE_BY, AnalystVerb, CLUSTER_BY, RANK_BY, SIMILAR_BY, WriteMode, WRITE_MODES } from "../session/types";
import { ensureProjectReady, errorMessage, reportEngineError } from "./shared";

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
    vscode.commands.registerCommand("graphforge.enableCapability", async () => {
      await runEnableCapability(session);
    }),

    vscode.commands.registerCommand("graphforge.openWithWriteMode", async () => {
      await runOpenWithWriteMode(session);
    }),

    vscode.commands.registerCommand(
      "graphforge.exportInvocationDescriptor",
      async () => {
        await runExportInvocationDescriptor(session);
      },
    ),

    vscode.commands.registerCommand("graphforge.listAlgorithmRuns", async () => {
      await runListAlgorithmRuns(session);
    }),

    vscode.commands.registerCommand(
      "graphforge.publishCompositeTransaction",
      async () => {
        await runPublishCompositeTransaction(session);
      },
    ),
  );
}

async function ensureReady(session: GraphForgeSession): Promise<boolean> {
  return ensureProjectReady(session);
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

async function runEnableCapability(session: GraphForgeSession): Promise<void> {
  if (!(await ensureReady(session))) {
    return;
  }
  const capabilityId = await vscode.window.showInputBox({
    title: "GraphForge: Enable Capability… — Capability ID",
    prompt: "Registered lowercase capability ID",
  });
  if (!capabilityId) {
    return;
  }
  const versionRaw = await vscode.window.showInputBox({
    title: "GraphForge: Enable Capability… — Capability version",
    value: "1",
  });
  if (versionRaw === undefined) {
    return;
  }
  const version = Number(versionRaw);
  if (!Number.isFinite(version)) {
    void vscode.window.showErrorMessage(
      "GraphForge: capability version must be a number.",
    );
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Enable capability "${capabilityId}" v${version}? This atomically mutates the project's capability manifest.`,
    { modal: true },
    "Enable",
  );
  if (confirm !== "Enable") {
    return;
  }
  try {
    const result = await session.enableCapability(capabilityId, version);
    await showJson("Enable Capability", result);
    void vscode.window.showInformationMessage(
      `GraphForge: capability "${capabilityId}" v${version} enabled.`,
    );
  } catch (err) {
    reportEngineError("Enable Capability failed", err);
  }
}

/**
 * Advanced reopen-with-mode (#11 open question resolved conservatively):
 * confirm before reopening, since it drops and recreates the native engine
 * handle even though it does not mutate committed project data.
 */
async function runOpenWithWriteMode(session: GraphForgeSession): Promise<void> {
  if (!(await ensureReady(session))) {
    return;
  }
  const mode = await vscode.window.showQuickPick([...WRITE_MODES], {
    title: "GraphForge: Open with Write Mode…",
    placeHolder: session.writeMode,
  });
  if (!mode) {
    return;
  }
  if (mode === session.writeMode) {
    void vscode.window.showInformationMessage(
      `GraphForge: already open in ${mode}.`,
    );
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Reopen the active project with write mode "${mode}" (currently "${session.writeMode}")?`,
    { modal: true },
    "Reopen",
  );
  if (confirm !== "Reopen") {
    return;
  }
  try {
    await session.reopenWithWriteMode(mode as WriteMode);
    void vscode.window.showInformationMessage(
      `GraphForge: reopened with write mode "${mode}".`,
    );
  } catch (err) {
    reportEngineError("Open with Write Mode failed", err);
  }
}

/**
 * Export a prepared invocation descriptor's fingerprint/canonical bytes to an
 * editor buffer (#11 AC — descriptor export works for at least one verb
 * path, e.g. rank). Uses the same label/by pickers as the analyst verbs.
 */
async function runExportInvocationDescriptor(
  session: GraphForgeSession,
): Promise<void> {
  if (!(await ensureReady(session))) {
    return;
  }
  const verb = await vscode.window.showQuickPick(DESCRIPTOR_VERBS, {
    title: "GraphForge: Export Invocation Descriptor — Verb",
    placeHolder: "rank",
  });
  if (!verb) {
    return;
  }
  const descriptorVerb = verb as Exclude<AnalystVerb, "find" | "paths">;
  const labels = await session.labels();
  const label = await vscode.window.showQuickPick(
    labels.length ? labels : ["Person"],
    { title: "GraphForge: Export Invocation Descriptor — Label" },
  );
  if (!label) {
    return;
  }
  const catalog = DESCRIPTOR_VERB_BY[descriptorVerb];
  const by = await vscode.window.showQuickPick([...catalog], {
    title: "GraphForge: Export Invocation Descriptor — Algorithm (by)",
    placeHolder: catalog[0],
  });
  if (!by) {
    return;
  }
  try {
    const descriptor = session.prepareInvocation(descriptorVerb, { label, by });
    const doc = await vscode.workspace.openTextDocument({
      content: JSON.stringify(
        {
          verb: descriptor.verb,
          algorithm: descriptor.algorithm,
          fingerprint: descriptor.fingerprint,
          projectionFingerprint: descriptor.projectionFingerprint,
          canonicalBytesBase64: descriptor.canonicalBytes.toString("base64"),
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
    const invoke = await vscode.window.showInformationMessage(
      `GraphForge: descriptor exported (fingerprint ${descriptor.fingerprint.slice(0, 12)}…). Invoke it now?`,
      "Invoke",
    );
    if (invoke) {
      const result = session.invokeDescriptor(descriptor);
      await showJson(`Invoke Descriptor (${verb})`, {
        columns: result.columns,
        rowCount: result.rowCount,
        rows: result.rows,
      });
    }
  } catch (err) {
    reportEngineError("Export Invocation Descriptor failed", err);
  }
}

async function runListAlgorithmRuns(session: GraphForgeSession): Promise<void> {
  if (!(await ensureReady(session))) {
    return;
  }
  try {
    const result = await session.listAlgorithmRuns(undefined, 100);
    await showJson("List Algorithm Runs", {
      columns: result.columns,
      rowCount: result.rowCount,
      rows: result.rows,
    });
  } catch (err) {
    reportEngineError("List Algorithm Runs failed", err);
  }
}

/**
 * Composite publish (#11) is deliberately Advanced-only: no visual builder,
 * just a JSON editor buffer + a link to engine docs, matching the tracker's
 * "no cascading menu mazes" doctrine for expert-only surfaces.
 */
async function runPublishCompositeTransaction(
  session: GraphForgeSession,
): Promise<void> {
  if (!(await ensureReady(session))) {
    return;
  }
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
    return;
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
    return;
  }

  let request: unknown;
  try {
    const raw = doc.getText().replace(/^\/\/.*$/gm, "");
    request = JSON.parse(raw);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `GraphForge: could not parse composite transaction JSON — ${errorMessage(err)}`,
    );
    return;
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
  } catch (err) {
    reportEngineError("Publish Composite Transaction failed", err);
  }
}
