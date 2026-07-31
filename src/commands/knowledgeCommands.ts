import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import { ResultGraphPanel } from "../webview/resultGraphPanel";
import {
  CONFIDENCE_POLICY_OPTIONS,
  EVIDENCE_ROLE_OPTIONS,
  EXPLICIT_STATUS_OPTIONS,
  GlossedOption,
  GRAPH_KIND_OPTIONS,
  SOURCE_KIND_OPTIONS,
} from "./pickerCopy";
import { CommandOutcome, ensureProjectOrRecover, reportEngineError } from "./shared";
import type {
  AssertionGraphKind,
  ConfidencePolicy,
  EvidenceRole,
  EvidenceSourceKind,
  ExplicitAssertionStatus,
  GraphPayload,
  QueryResult,
} from "../session/types";

/**
 * Optional args (#36) so a coding agent can drive each knowledge command via
 * `executeCommand` without any InputBox/QuickPick. `showAssertion` /
 * `showAssertionOnGraph` also still accept a plain UUID string (tree-item
 * clicks pass one).
 */
export interface ListAssertionsArgs {
  graphUuid?: string;
  limit?: number;
}
export interface CreateAssertionArgs {
  claim?: string;
  subjectUuid?: string;
  subjectKind?: AssertionGraphKind;
}
export interface AssertionRefArgs {
  assertionUuid?: string;
}
export interface AttachEvidenceArgs {
  assertionUuid?: string;
  sourceUuid?: string;
  sourceKind?: EvidenceSourceKind;
  role?: EvidenceRole;
}
export interface AssessConfidenceArgs {
  assertionUuid?: string;
  policy?: ConfidencePolicy;
  value?: number;
}
export interface RecordAssertionStatusArgs {
  assertionUuid?: string;
  status?: ExplicitAssertionStatus;
  provenanceUuid?: string;
}

/** Truncate a long string for display in a quick pick / detail line. */
function truncate(text: string, max = 80): string {
  const collapsed = text.trim().replace(/\s+/g, " ");
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

/**
 * `showQuickPick` over a glossed literal-union option list (#40): the raw
 * engine token stays as the label, with one line of plain-language `detail`
 * per option, without losing the literal type.
 */
async function pickFrom<T extends string>(
  items: readonly GlossedOption<T>[],
  title: string,
): Promise<T | undefined> {
  const picked = await vscode.window.showQuickPick(
    items.map((item) => ({ ...item })),
    { title: `GraphForge: ${title}` },
  );
  return picked?.label;
}

function isUuidish(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

async function openJsonDoc(content: unknown): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    content: JSON.stringify(content, null, 2),
    language: "json",
  });
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: true,
  });
}

/**
 * Resolve an assertion UUID argument that may come from a tree-item click
 * (already a plain UUID string), an agent args object (`{ assertionUuid }`),
 * or be missing (palette invocation), in which case the analyst is prompted
 * to pick from the ledger or paste one in.
 */
async function resolveAssertionUuid(
  session: GraphForgeSession,
  arg?: unknown,
): Promise<string | undefined> {
  if (typeof arg === "string" && isUuidish(arg)) {
    return arg;
  }
  if (arg && typeof arg === "object") {
    const fromArgs = (arg as AssertionRefArgs).assertionUuid;
    if (typeof fromArgs === "string" && isUuidish(fromArgs)) {
      return fromArgs;
    }
  }
  const summary = await session.knowledgeSummary();
  if (summary.assertions.length === 0) {
    const typed = await vscode.window.showInputBox({
      title: "GraphForge: Assertion UUID",
      prompt: "No assertions loaded to pick from — paste an assertion UUID.",
    });
    return typed || undefined;
  }
  const picked = await vscode.window.showQuickPick(
    summary.assertions.map((a) => ({
      label: truncate(a.claim || "(empty claim)"),
      description: a.assertionUuid,
      uuid: a.assertionUuid,
    })),
    { title: "GraphForge: Select Assertion" },
  );
  return picked?.uuid;
}

export function registerKnowledgeCommands(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
  refreshTrees: () => void,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "graphforge.listAssertions",
      (args?: ListAssertionsArgs) => runListAssertions(session, args),
    ),
    vscode.commands.registerCommand(
      "graphforge.createAssertion",
      (args?: CreateAssertionArgs) => runCreateAssertion(session, refreshTrees, args),
    ),
    vscode.commands.registerCommand("graphforge.showAssertion", (arg?: unknown) =>
      runShowAssertion(session, arg),
    ),
    vscode.commands.registerCommand(
      "graphforge.showAssertionOnGraph",
      (arg?: unknown) => runShowAssertionOnGraph(context, session, arg),
    ),
    vscode.commands.registerCommand(
      "graphforge.attachEvidence",
      (args?: AttachEvidenceArgs) => runAttachEvidence(session, args),
    ),
    vscode.commands.registerCommand(
      "graphforge.assessConfidence",
      (args?: AssessConfidenceArgs) => runAssessConfidence(session, args),
    ),
    vscode.commands.registerCommand(
      "graphforge.recordAssertionStatus",
      (args?: RecordAssertionStatusArgs) => runRecordAssertionStatus(session, args),
    ),
  );
}

async function runListAssertions(
  session: GraphForgeSession,
  args?: ListAssertionsArgs,
): Promise<CommandOutcome<QueryResult>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  try {
    const result = await session.listAssertions({
      graphUuid: args?.graphUuid,
      limit: args?.limit ?? 100,
    });
    await openJsonDoc({
      rowCount: result.rowCount,
      columns: result.columns,
      rows: result.rows,
    });
    return result;
  } catch (err) {
    return reportEngineError("List Assertions failed", err);
  }
}

/**
 * Palette-first, minimal-field Create Assertion: claim + one graph reference
 * (subject). Evidence, confidence, and status are deliberately out of scope
 * here — they're separate Advanced commands per the UX doctrine.
 */
async function runCreateAssertion(
  session: GraphForgeSession,
  refreshTrees: () => void,
  args?: CreateAssertionArgs,
): Promise<CommandOutcome<{ assertionUuid: string }>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }

  const claim =
    args?.claim?.trim() ||
    (await vscode.window.showInputBox({
      title: "GraphForge: Create Assertion (1/3) — Claim",
      prompt: "State the assertion in plain language.",
      ignoreFocusOut: true,
    }));
  if (!claim) {
    return { cancelled: true };
  }

  const subjectUuid =
    args?.subjectUuid?.trim() ||
    (await vscode.window.showInputBox({
      title: "GraphForge: Create Assertion (2/3) — Subject UUID",
      prompt: "UUID of the graph node or edge this assertion is about.",
      ignoreFocusOut: true,
      validateInput: (v) =>
        v && !isUuidish(v) ? "Expected a UUID" : undefined,
    }));
  if (!subjectUuid) {
    return { cancelled: true };
  }
  if (!isUuidish(subjectUuid)) {
    return { error: `subjectUuid is not a UUID: ${subjectUuid}` };
  }

  const subjectKind =
    args?.subjectKind ??
    (await pickFrom(GRAPH_KIND_OPTIONS, "Create Assertion (3/3) — Subject kind"));
  if (!subjectKind) {
    return { cancelled: true };
  }

  try {
    const { assertionUuid } = await session.createAssertion({
      claim,
      graphRefs: [
        { graphUuid: subjectUuid, graphKind: subjectKind, role: "subject", ordinal: 0 },
      ],
    });
    refreshTrees();
    // Fire-and-forget follow-up so a programmatic caller is never blocked on
    // a toast nobody will dismiss; the buttons still work for humans.
    void vscode.window
      .showInformationMessage(
        `Assertion created: ${assertionUuid}`,
        "Show Assertion",
        "Show on Graph",
      )
      .then((choice) => {
        if (choice === "Show Assertion") {
          return runShowAssertion(session, assertionUuid);
        }
        if (choice === "Show on Graph") {
          return vscode.commands.executeCommand(
            "graphforge.showAssertionOnGraph",
            assertionUuid,
          );
        }
        return undefined;
      });
    return { assertionUuid };
  } catch (err) {
    return reportEngineError("Create Assertion failed", err);
  }
}

async function runShowAssertion(
  session: GraphForgeSession,
  arg?: unknown,
): Promise<CommandOutcome<Record<string, unknown>>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  const assertionUuid = await resolveAssertionUuid(session, arg);
  if (!assertionUuid) {
    return { cancelled: true };
  }
  try {
    const assertion = await session.getAssertion(assertionUuid);
    if (!assertion) {
      void vscode.window.showWarningMessage(
        `Assertion not found: ${assertionUuid}`,
      );
      return { error: `Assertion not found: ${assertionUuid}` };
    }
    const payload = {
      ...assertion,
      nextActions: [
        "graphforge.showAssertionOnGraph",
        "graphforge.attachEvidence",
        "graphforge.assessConfidence",
        "graphforge.recordAssertionStatus",
      ],
    };
    await openJsonDoc(payload);
    return payload;
  } catch (err) {
    return reportEngineError("Show Assertion failed", err);
  }
}

async function runShowAssertionOnGraph(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
  arg?: unknown,
): Promise<CommandOutcome<{ assertionUuid: string; graph: GraphPayload }>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  const assertionUuid = await resolveAssertionUuid(session, arg);
  if (!assertionUuid) {
    return { cancelled: true };
  }
  try {
    const assertion = await session.getAssertion(assertionUuid);
    const refs = await session.assertionGraphRefs(assertionUuid);
    const graph = assertionToGraphPayload(assertionUuid, assertion?.claim ?? "", refs);
    ResultGraphPanel.show(context.extensionUri, graph);
    return { assertionUuid, graph };
  } catch (err) {
    return reportEngineError("Show on Graph failed", err);
  }
}

function assertionToGraphPayload(
  assertionUuid: string,
  claim: string,
  refs: Array<Record<string, unknown>>,
): GraphPayload {
  const nodes: GraphPayload["nodes"] = [
    {
      id: assertionUuid,
      labels: ["Assertion"],
      ontologyType: "Assertion",
      epistemicStatus: "statusless",
      properties: { claim },
    },
  ];
  const edges: GraphPayload["edges"] = [];
  refs.forEach((ref, i) => {
    const graphUuid = String(ref.graph_uuid ?? ref.graphUuid ?? `ref-${i}`);
    const role = String(ref.role ?? "context");
    nodes.push({
      id: graphUuid,
      labels: [String(ref.graph_kind ?? ref.graphKind ?? "Node")],
      ontologyType: String(ref.graph_kind ?? ref.graphKind ?? "Node"),
      epistemicStatus: "statusless",
      properties: ref,
    });
    edges.push({
      id: `${assertionUuid}-${graphUuid}`,
      type: role.toUpperCase(),
      source: assertionUuid,
      target: graphUuid,
      epistemicStatus: "statusless",
    });
  });
  return {
    nodes,
    edges,
    legend: { statuses: ["statusless"], types: ["Assertion"] },
    title: `Assertion ${assertionUuid.slice(0, 8)}`,
    styleMode: "class-only",
  };
}

/** Advanced: attach one evidence link. Kept out of Create Assertion by design. */
async function runAttachEvidence(
  session: GraphForgeSession,
  args?: AttachEvidenceArgs,
): Promise<CommandOutcome<QueryResult>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  const assertionUuid = await resolveAssertionUuid(session, args);
  if (!assertionUuid) {
    return { cancelled: true };
  }
  const sourceUuid =
    args?.sourceUuid?.trim() ||
    (await vscode.window.showInputBox({
      title: "GraphForge: Attach Evidence — Source UUID",
      validateInput: (v) => (v && !isUuidish(v) ? "Expected a UUID" : undefined),
    }));
  if (!sourceUuid) {
    return { cancelled: true };
  }
  const sourceKind =
    args?.sourceKind ??
    (await pickFrom(SOURCE_KIND_OPTIONS, "Attach Evidence — Source kind"));
  if (!sourceKind) {
    return { cancelled: true };
  }
  const role =
    args?.role ?? (await pickFrom(EVIDENCE_ROLE_OPTIONS, "Attach Evidence — Role"));
  if (!role) {
    return { cancelled: true };
  }
  try {
    const result = await session.attachEvidence({
      assertionUuid,
      sourceUuid,
      sourceKind,
      role,
    });
    void vscode.window.showInformationMessage("Evidence attached.");
    return result;
  } catch (err) {
    return reportEngineError("Attach Evidence failed", err);
  }
}

/** Advanced: record one confidence assessment. Kept out of Create Assertion by design. */
async function runAssessConfidence(
  session: GraphForgeSession,
  args?: AssessConfidenceArgs,
): Promise<CommandOutcome<QueryResult>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  const assertionUuid = await resolveAssertionUuid(session, args);
  if (!assertionUuid) {
    return { cancelled: true };
  }
  const policy =
    args?.policy ??
    (await pickFrom(CONFIDENCE_POLICY_OPTIONS, "Assess Confidence — Policy"));
  if (!policy) {
    return { cancelled: true };
  }
  let value: number | undefined;
  if (policy === "explicit") {
    if (typeof args?.value === "number") {
      value = args.value;
    } else {
      const raw = await vscode.window.showInputBox({
        title: "GraphForge: Assess Confidence — Value (0.0–1.0)",
        validateInput: (v) => {
          const n = Number(v);
          return Number.isFinite(n) && n >= 0 && n <= 1
            ? undefined
            : "Enter a number between 0 and 1";
        },
      });
      if (raw === undefined) {
        return { cancelled: true };
      }
      value = Number(raw);
    }
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      return { error: "explicit confidence value must be a number between 0 and 1." };
    }
  }
  try {
    const result = await session.assessConfidence({ assertionUuid, policy, value });
    void vscode.window.showInformationMessage("Confidence recorded.");
    return result;
  } catch (err) {
    return reportEngineError("Assess Confidence failed", err);
  }
}

/**
 * Advanced: record one explicit status event. The engine requires an existing
 * `provenanceUuid` for this write; until there's a picker for provenance
 * records, the analyst pastes one in directly.
 */
async function runRecordAssertionStatus(
  session: GraphForgeSession,
  args?: RecordAssertionStatusArgs,
): Promise<CommandOutcome<QueryResult>> {
  const recovery = await ensureProjectOrRecover(session);
  if (recovery) {
    return recovery;
  }
  const assertionUuid = await resolveAssertionUuid(session, args);
  if (!assertionUuid) {
    return { cancelled: true };
  }
  const status =
    args?.status ?? (await pickFrom(EXPLICIT_STATUS_OPTIONS, "Record Status — Status"));
  if (!status) {
    return { cancelled: true };
  }
  const provenanceUuid =
    args?.provenanceUuid?.trim() ||
    (await vscode.window.showInputBox({
      title: "GraphForge: Record Status — Provenance UUID",
      prompt: "Existing provenance record UUID backing this status event.",
      validateInput: (v) => (v && !isUuidish(v) ? "Expected a UUID" : undefined),
    }));
  if (!provenanceUuid) {
    return { cancelled: true };
  }
  try {
    const result = await session.recordAssertionStatus({
      assertionUuid,
      status,
      provenanceUuid,
    });
    void vscode.window.showInformationMessage("Assertion status recorded.");
    return result;
  } catch (err) {
    return reportEngineError("Record Status failed", err);
  }
}
