import type {
  AssertionGraphKind,
  ConfidencePolicy,
  EvidenceRole,
  EvidenceSourceKind,
  ExplicitAssertionStatus,
  WriteMode,
} from "../session/types";

/**
 * Plain-language glosses for every raw-enum QuickPick (#40). The engine
 * token stays visible as the `label` (it's the value the engine actually
 * receives); the `detail` is one line of workbench-voice copy so an analyst
 * never faces a bare token like `optimistic_multi_writer` or
 * `conservative_min`. Kept free of `vscode` imports so the copy is unit
 * testable under plain mocha (same convention as `errorPresentation.ts`).
 */
export interface GlossedOption<T extends string = string> {
  label: T;
  detail: string;
}

/** Diff Checkpoints… — Scope picker (`session.diffCheckpoints`). */
export const DIFF_SCOPE_OPTIONS: readonly GlossedOption[] = [
  { label: "summary", detail: "One high-level overview of everything that changed" },
  { label: "graph", detail: "Changes to nodes and relationships" },
  { label: "ontology", detail: "Changes to the ontology (types and structure)" },
  { label: "configuration", detail: "Changes to project settings" },
  { label: "capabilities", detail: "Changes to what the project can do (enabled capabilities)" },
  { label: "provenance", detail: "Changes to where-did-this-come-from records" },
  { label: "knowledge", detail: "Changes to assertions and their evidence" },
  { label: "epistemic", detail: "Changes to confidence and assertion status" },
  { label: "all", detail: "Every area above in a single diff" },
];

/** Diff Checkpoints… — Detail picker (`session.diffCheckpoints`). */
export const DIFF_DETAIL_OPTIONS: readonly GlossedOption[] = [
  { label: "summary", detail: "Just the counts — a quick before/after overview" },
  { label: "records", detail: "Every changed record, row by row" },
];

/** Open with Write Mode… picker (`WRITE_MODES`, ADR 0015). */
export const WRITE_MODE_OPTIONS: readonly GlossedOption<WriteMode>[] = [
  {
    label: "single_writer",
    detail: "One writer at a time — the safest default; a second writer is refused",
  },
  {
    label: "queued_writer",
    detail: "Writers take turns — extra writers wait in line instead of being refused",
  },
  {
    label: "optimistic_multi_writer",
    detail: "Several writers at once — conflicts are caught when changes are committed",
  },
];

/** Create Assertion — Subject kind picker (`GRAPH_KINDS`). */
export const GRAPH_KIND_OPTIONS: readonly GlossedOption<AssertionGraphKind>[] = [
  { label: "node", detail: "A thing in the graph (a node)" },
  { label: "edge", detail: "A relationship between two nodes" },
];

/** Attach Evidence — Source kind picker (`SOURCE_KINDS`). */
export const SOURCE_KIND_OPTIONS: readonly GlossedOption<EvidenceSourceKind>[] = [
  { label: "document", detail: "An external document — a paper, page, or file" },
  { label: "observation", detail: "Something directly observed or measured" },
  { label: "graph_node", detail: "Another node already in this graph" },
  { label: "graph_edge", detail: "A relationship already in this graph" },
];

/** Attach Evidence — Role picker (`EVIDENCE_ROLES`). */
export const EVIDENCE_ROLE_OPTIONS: readonly GlossedOption<EvidenceRole>[] = [
  { label: "supports", detail: "This source backs the assertion up" },
  { label: "contradicts", detail: "This source argues against the assertion" },
  { label: "context", detail: "Background that informs the assertion without taking a side" },
];

/** Assess Confidence — Policy picker (`CONFIDENCE_POLICIES`). */
export const CONFIDENCE_POLICY_OPTIONS: readonly GlossedOption<ConfidencePolicy>[] = [
  { label: "explicit", detail: "You set the confidence value yourself (0.0–1.0)" },
  {
    label: "conservative_min",
    detail: "GraphForge uses the lowest confidence found across the evidence",
  },
];

/** Record Status — Status picker (`EXPLICIT_STATUSES`). */
export const EXPLICIT_STATUS_OPTIONS: readonly GlossedOption<ExplicitAssertionStatus>[] = [
  { label: "hypothesis", detail: "Proposed, not yet weighed against evidence" },
  { label: "supported", detail: "The evidence backs this assertion" },
  { label: "refuted", detail: "The evidence contradicts this assertion" },
  { label: "disputed", detail: "Sources disagree — there is no settled answer" },
  { label: "retracted", detail: "Withdrawn by whoever asserted it" },
  { label: "superseded", detail: "Replaced by a newer assertion" },
];
