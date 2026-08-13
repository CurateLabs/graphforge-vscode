import type { EpistemicStatus } from "./types";

/**
 * Pure (vscode-free) helpers behind the Knowledge view's epistemic-status
 * surface (#35): status-count aggregation for `knowledgeSummary()` and the
 * per-status tree presentation (codicon + theme color). Kept out of
 * `knowledgeTree.ts` so they stay unit-testable without an extension host.
 */

/** How one epistemic status renders in the Knowledge tree. */
export interface StatusTreeDisplay {
  /** Codicon identifier (no `$()` wrapper). */
  icon: string;
  /** Theme color id for the icon; omitted = default foreground. */
  themeColor?: string;
}

/**
 * Status → icon/color, aligned with the webview's `EPISTEMIC_COLORS` palette
 * (green supported, yellow hypothesis, orange disputed, reds refuted /
 * retracted, gray superseded) but expressed as VS Code theme colors so the
 * tree respects the active theme.
 */
export const STATUS_TREE_DISPLAY: Record<EpistemicStatus, StatusTreeDisplay> = {
  supported: { icon: "pass", themeColor: "charts.green" },
  hypothesis: { icon: "beaker", themeColor: "charts.yellow" },
  disputed: { icon: "warning", themeColor: "charts.orange" },
  refuted: { icon: "error", themeColor: "charts.red" },
  retracted: { icon: "circle-slash", themeColor: "charts.red" },
  superseded: { icon: "history", themeColor: "descriptionForeground" },
  statusless: { icon: "law" },
};

/** Stable display order for the status breakdown; statusless last. */
export const STATUS_BREAKDOWN_ORDER: readonly EpistemicStatus[] = [
  "supported",
  "hypothesis",
  "disputed",
  "refuted",
  "retracted",
  "superseded",
  "statusless",
];

/**
 * Count assertions per status. `undefined` entries (status lookup failed for
 * that assertion) are deliberately excluded rather than counted as
 * "statusless" — an unresolved status is not the same as a resolved absence.
 */
export function aggregateStatusCounts(
  statuses: Iterable<EpistemicStatus | undefined>,
): Partial<Record<EpistemicStatus, number>> {
  const counts: Partial<Record<EpistemicStatus, number>> = {};
  for (const status of statuses) {
    if (!status) {
      continue;
    }
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

/** Non-zero status counts in {@link STATUS_BREAKDOWN_ORDER}, ready for tree rows. */
export function statusBreakdownEntries(
  counts: Partial<Record<EpistemicStatus, number>>,
): Array<{ status: EpistemicStatus; count: number }> {
  return STATUS_BREAKDOWN_ORDER.flatMap((status) => {
    const count = counts[status];
    return count ? [{ status, count }] : [];
  });
}
