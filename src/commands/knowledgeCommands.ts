import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import { ResultGraphPanel } from "../webview/resultGraphPanel";
import { ensureProjectReady } from "./shared";
import type {
  AssertionGraphKind,
  ConfidencePolicy,
  EvidenceRole,
  EvidenceSourceKind,
  ExplicitAssertionStatus,
  GraphPayload,
} from "../session/types";

const GRAPH_KINDS: readonly AssertionGraphKind[] = ["node", "edge"];
const SOURCE_KINDS: readonly EvidenceSourceKind[] = [
  "document",
  "observation",
  "graph_node",
  "graph_edge",
];
const EVIDENCE_ROLES: readonly EvidenceRole[] = [
  "supports",
  "contradicts",
  "context",
];
const CONFIDENCE_POLICIES: readonly ConfidencePolicy[] = [
  "explicit",
  "conservative_min",
];
const EXPLICIT_STATUSES: readonly ExplicitAssertionStatus[] = [
  "hypothesis",
  "supported",
  "refuted",
  "disputed",
  "retracted",
  "superseded",
];

/** Truncate a long string for display in a quick pick / detail line. */
function truncate(text: string, max = 80): string {
  const collapsed = text.trim().replace(/\s+/g, " ");
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

/** `showQuickPick` over a literal-union array without losing the literal type. */
async function pickFrom<T extends string>(
  items: readonly T[],
  title: string,
): Promise<T | undefined> {
  const picked = await vscode.window.showQuickPick([...items], {
    title: `GraphForge: ${title}`,
  });
  return picked as T | undefined;
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
 * (already a plain UUID string) or be missing (palette invocation), in which
 * case the analyst is prompted to pick from the ledger or paste one in.
 */
async function resolveAssertionUuid(
  session: GraphForgeSession,
  arg?: unknown,
): Promise<string | undefined> {
  if (typeof arg === "string" && isUuidish(arg)) {
    return arg;
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
    vscode.commands.registerCommand("graphforge.listAssertions", () =>
      runListAssertions(session),
    ),
    vscode.commands.registerCommand("graphforge.createAssertion", () =>
      runCreateAssertion(session, refreshTrees),
    ),
    vscode.commands.registerCommand("graphforge.showAssertion", (arg?: unknown) =>
      runShowAssertion(session, arg),
    ),
    vscode.commands.registerCommand(
      "graphforge.showAssertionOnGraph",
      (arg?: unknown) => runShowAssertionOnGraph(context, session, arg),
    ),
    vscode.commands.registerCommand("graphforge.attachEvidence", () =>
      runAttachEvidence(session),
    ),
    vscode.commands.registerCommand("graphforge.assessConfidence", () =>
      runAssessConfidence(session),
    ),
    vscode.commands.registerCommand("graphforge.recordAssertionStatus", () =>
      runRecordAssertionStatus(session),
    ),
  );
}

async function runListAssertions(session: GraphForgeSession): Promise<void> {
  if (!(await ensureProjectReady(session))) {
    return;
  }
  try {
    const result = await session.listAssertions({ limit: 100 });
    await openJsonDoc({
      rowCount: result.rowCount,
      columns: result.columns,
      rows: result.rows,
    });
  } catch (err) {
    void vscode.window.showErrorMessage(
      `List Assertions failed: ${err instanceof Error ? err.message : String(err)}`,
    );
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
): Promise<void> {
  if (!(await ensureProjectReady(session))) {
    return;
  }

  const claim = await vscode.window.showInputBox({
    title: "GraphForge: Create Assertion (1/3) — Claim",
    prompt: "State the assertion in plain language.",
    ignoreFocusOut: true,
  });
  if (!claim) {
    return;
  }

  const subjectUuid = await vscode.window.showInputBox({
    title: "GraphForge: Create Assertion (2/3) — Subject UUID",
    prompt: "UUID of the graph node or edge this assertion is about.",
    ignoreFocusOut: true,
    validateInput: (v) =>
      v && !isUuidish(v) ? "Expected a UUID" : undefined,
  });
  if (!subjectUuid) {
    return;
  }

  const subjectKind = await pickFrom(GRAPH_KINDS, "Create Assertion (3/3) — Subject kind");
  if (!subjectKind) {
    return;
  }

  try {
    const { assertionUuid } = await session.createAssertion({
      claim,
      graphRefs: [
        { graphUuid: subjectUuid, graphKind: subjectKind, role: "subject", ordinal: 0 },
      ],
    });
    refreshTrees();
    const choice = await vscode.window.showInformationMessage(
      `Assertion created: ${assertionUuid}`,
      "Show Assertion",
      "Show on Graph",
    );
    if (choice === "Show Assertion") {
      await runShowAssertion(session, assertionUuid);
    } else if (choice === "Show on Graph") {
      await vscode.commands.executeCommand(
        "graphforge.showAssertionOnGraph",
        assertionUuid,
      );
    }
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Create Assertion failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function runShowAssertion(
  session: GraphForgeSession,
  arg?: unknown,
): Promise<void> {
  if (!(await ensureProjectReady(session))) {
    return;
  }
  const assertionUuid = await resolveAssertionUuid(session, arg);
  if (!assertionUuid) {
    return;
  }
  try {
    const assertion = await session.getAssertion(assertionUuid);
    if (!assertion) {
      void vscode.window.showWarningMessage(
        `Assertion not found: ${assertionUuid}`,
      );
      return;
    }
    await openJsonDoc({
      ...assertion,
      nextActions: [
        "graphforge.showAssertionOnGraph",
        "graphforge.attachEvidence",
        "graphforge.assessConfidence",
        "graphforge.recordAssertionStatus",
      ],
    });
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Show Assertion failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function runShowAssertionOnGraph(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
  arg?: unknown,
): Promise<void> {
  if (!(await ensureProjectReady(session))) {
    return;
  }
  const assertionUuid = await resolveAssertionUuid(session, arg);
  if (!assertionUuid) {
    return;
  }
  try {
    const assertion = await session.getAssertion(assertionUuid);
    const refs = await session.assertionGraphRefs(assertionUuid);
    ResultGraphPanel.show(
      context.extensionUri,
      assertionToGraphPayload(assertionUuid, assertion?.claim ?? "", refs),
    );
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Show on Graph failed: ${err instanceof Error ? err.message : String(err)}`,
    );
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
async function runAttachEvidence(session: GraphForgeSession): Promise<void> {
  if (!(await ensureProjectReady(session))) {
    return;
  }
  const assertionUuid = await resolveAssertionUuid(session);
  if (!assertionUuid) {
    return;
  }
  const sourceUuid = await vscode.window.showInputBox({
    title: "GraphForge: Attach Evidence — Source UUID",
    validateInput: (v) => (v && !isUuidish(v) ? "Expected a UUID" : undefined),
  });
  if (!sourceUuid) {
    return;
  }
  const sourceKind = await pickFrom(SOURCE_KINDS, "Attach Evidence — Source kind");
  if (!sourceKind) {
    return;
  }
  const role = await pickFrom(EVIDENCE_ROLES, "Attach Evidence — Role");
  if (!role) {
    return;
  }
  try {
    await session.attachEvidence({ assertionUuid, sourceUuid, sourceKind, role });
    void vscode.window.showInformationMessage("Evidence attached.");
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Attach Evidence failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Advanced: record one confidence assessment. Kept out of Create Assertion by design. */
async function runAssessConfidence(session: GraphForgeSession): Promise<void> {
  if (!(await ensureProjectReady(session))) {
    return;
  }
  const assertionUuid = await resolveAssertionUuid(session);
  if (!assertionUuid) {
    return;
  }
  const policy = await pickFrom(CONFIDENCE_POLICIES, "Assess Confidence — Policy");
  if (!policy) {
    return;
  }
  let value: number | undefined;
  if (policy === "explicit") {
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
      return;
    }
    value = Number(raw);
  }
  try {
    await session.assessConfidence({ assertionUuid, policy, value });
    void vscode.window.showInformationMessage("Confidence recorded.");
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Assess Confidence failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Advanced: record one explicit status event. The engine requires an existing
 * `provenanceUuid` for this write; until there's a picker for provenance
 * records, the analyst pastes one in directly.
 */
async function runRecordAssertionStatus(
  session: GraphForgeSession,
): Promise<void> {
  if (!(await ensureProjectReady(session))) {
    return;
  }
  const assertionUuid = await resolveAssertionUuid(session);
  if (!assertionUuid) {
    return;
  }
  const status = await pickFrom(EXPLICIT_STATUSES, "Record Status — Status");
  if (!status) {
    return;
  }
  const provenanceUuid = await vscode.window.showInputBox({
    title: "GraphForge: Record Status — Provenance UUID",
    prompt: "Existing provenance record UUID backing this status event.",
    validateInput: (v) => (v && !isUuidish(v) ? "Expected a UUID" : undefined),
  });
  if (!provenanceUuid) {
    return;
  }
  try {
    await session.recordAssertionStatus({ assertionUuid, status, provenanceUuid });
    void vscode.window.showInformationMessage("Assertion status recorded.");
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Record Status failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
