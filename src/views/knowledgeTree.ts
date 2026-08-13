import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import {
  STATUS_TREE_DISPLAY,
  statusBreakdownEntries,
} from "../session/knowledgeStatus";
import type { AssertionRow, EpistemicStatus, KnowledgeSummary } from "../session/types";

type Node =
  | { kind: "summary"; label: string; description?: string }
  | { kind: "group"; label: string; children: Node[] }
  | { kind: "assertion"; uuid: string; claim: string; status?: EpistemicStatus }
  | {
      kind: "note";
      label: string;
      description?: string;
      icon?: string;
      /** Theme color id applied to the icon (used for status-breakdown rows). */
      themeColor?: string;
    }
  | { kind: "action"; label: string; command: string; icon: string };

/** ThemeIcon for one epistemic status, colored per {@link STATUS_TREE_DISPLAY}. */
function statusThemeIcon(status: EpistemicStatus): vscode.ThemeIcon {
  const display = STATUS_TREE_DISPLAY[status];
  return new vscode.ThemeIcon(
    display.icon,
    display.themeColor ? new vscode.ThemeColor(display.themeColor) : undefined,
  );
}

/**
 * Status-breakdown node for the tree root: real per-status counts when the
 * lookup worked, otherwise an explicit "unavailable" row — never an empty
 * breakdown that could read as "no statuses recorded" (#35).
 */
function statusBreakdownNode(summary: KnowledgeSummary): Node {
  if (!summary.statusAvailable) {
    return {
      kind: "note",
      label: "Status unavailable",
      description:
        summary.statusNote ??
        "Assertion status lookup is unavailable with this binding.",
      icon: "warning",
    };
  }
  const entries = statusBreakdownEntries(summary.statusCounts);
  return {
    kind: "group",
    label: "Status breakdown",
    children: entries.length
      ? entries.map(
          ({ status, count }): Node => ({
            kind: "note",
            label: status,
            description: String(count),
            icon: STATUS_TREE_DISPLAY[status].icon,
            themeColor: STATUS_TREE_DISPLAY[status].themeColor,
          }),
        )
      : [{ kind: "note", label: "No statuses resolved", icon: "info" }],
  };
}

function truncate(text: string, max = 64): string {
  const collapsed = text.trim().replace(/\s+/g, " ");
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

export class KnowledgeTreeProvider
  implements vscode.TreeDataProvider<Node>, vscode.Disposable
{
  private readonly _onDidChange = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private readonly sub: vscode.Disposable;

  constructor(private readonly session: GraphForgeSession) {
    this.sub = session.onDidChange(() => this._onDidChange.fire(undefined));
  }

  dispose(): void {
    this.sub.dispose();
    this._onDidChange.dispose();
  }

  refresh(): void {
    this._onDidChange.fire(undefined);
  }

  getTreeItem(element: Node): vscode.TreeItem {
    if (element.kind === "group") {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon("symbol-namespace");
      return item;
    }
    if (element.kind === "assertion") {
      const item = new vscode.TreeItem(
        truncate(element.claim || "(empty claim)"),
        vscode.TreeItemCollapsibleState.None,
      );
      // Epistemic status is always named (#35): show it in the description and
      // color the icon per status. When the status could not be resolved,
      // fall back to the neutral ledger icon with no status text — the root
      // "Status unavailable" row explains why.
      const shortUuid = element.uuid.slice(0, 8);
      item.description = element.status
        ? `${element.status} · ${shortUuid}`
        : shortUuid;
      item.iconPath = element.status
        ? statusThemeIcon(element.status)
        : new vscode.ThemeIcon("law");
      item.command = {
        command: "graphforge.showAssertion",
        title: "Show Assertion",
        arguments: [element.uuid],
      };
      item.contextValue = "graphforge.assertion";
      return item;
    }
    if (element.kind === "action") {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon(element.icon);
      item.command = { command: element.command, title: element.label };
      return item;
    }
    const item = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None,
    );
    if (element.kind === "summary") {
      item.description = element.description;
      item.iconPath = new vscode.ThemeIcon("book");
    } else {
      item.description = element.description;
      item.iconPath = new vscode.ThemeIcon(
        element.icon ?? "info",
        element.themeColor ? new vscode.ThemeColor(element.themeColor) : undefined,
      );
    }
    return item;
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (element?.kind === "group") {
      return element.children;
    }
    if (element) {
      return [];
    }

    if (!this.session.project) {
      return [
        {
          kind: "note",
          label: "Open a project to inspect knowledge",
          icon: "info",
        },
        {
          kind: "action",
          label: "Open Project…",
          command: "graphforge.openProject",
          icon: "folder-opened",
        },
      ];
    }

    const summary = await this.session.knowledgeSummary();

    if (!summary.capabilityAvailable) {
      return [
        {
          kind: "note",
          label: "Knowledge ledger unavailable",
          description: summary.note,
          icon: "warning",
        },
        {
          kind: "action",
          label: "Check Environment…",
          command: "graphforge.checkEnvironment",
          icon: "pulse",
        },
      ];
    }

    if (summary.assertionCount === 0) {
      return [
        {
          kind: "note",
          label: "No assertions yet",
          description: "The knowledge ledger is empty for this project.",
          icon: "law",
        },
        {
          kind: "action",
          label: "Create Assertion…",
          command: "graphforge.createAssertion",
          icon: "add",
        },
      ];
    }

    const nodes: Node[] = [
      {
        kind: "summary",
        label: `Assertions: ${summary.assertionCount}`,
        description: "knowledge@1 ledger",
      },
      statusBreakdownNode(summary),
      ...summary.assertions.map(
        (a: AssertionRow): Node => ({
          kind: "assertion",
          uuid: a.assertionUuid,
          claim: a.claim,
          status: a.status,
        }),
      ),
      {
        kind: "action",
        label: "Create Assertion…",
        command: "graphforge.createAssertion",
        icon: "add",
      },
    ];

    if (summary.statusAvailable && summary.statusNote) {
      nodes.push({ kind: "note", label: summary.statusNote, icon: "info" });
    }
    if (summary.note) {
      nodes.push({ kind: "note", label: summary.note, icon: "info" });
    }

    return nodes;
  }
}
