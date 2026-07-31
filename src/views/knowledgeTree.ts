import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import type { EpistemicStatus } from "../session/types";

type Node =
  | { kind: "summary"; label: string; description?: string }
  | { kind: "status"; status: EpistemicStatus; count: number }
  | { kind: "note"; label: string };

const STATUS_ORDER: EpistemicStatus[] = [
  "supported",
  "hypothesis",
  "disputed",
  "refuted",
  "retracted",
  "superseded",
  "statusless",
];

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
    const item = new vscode.TreeItem(
      element.kind === "status"
        ? element.status
        : element.label,
      vscode.TreeItemCollapsibleState.None,
    );
    if (element.kind === "status") {
      item.description = String(element.count);
      item.iconPath = new vscode.ThemeIcon("circle-filled");
    } else if (element.kind === "summary") {
      item.description = element.description;
      item.iconPath = new vscode.ThemeIcon("book");
      item.command = {
        command: "graphforge.showResultGraph",
        title: "Show Result Graph",
      };
    } else {
      item.iconPath = new vscode.ThemeIcon("info");
    }
    return item;
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (element) {
      return [];
    }
    if (!this.session.project) {
      return [{ kind: "note", label: "Open a project to inspect knowledge" }];
    }

    const summary = await this.session.knowledgeSummary();
    const nodes: Node[] = [
      {
        kind: "summary",
        label: `Assertions: ${summary.assertionCount}`,
        description: "knowledge@1 ledger",
      },
    ];

    for (const status of STATUS_ORDER) {
      const count = summary.statusCounts[status] ?? 0;
      if (count > 0 || status === "statusless") {
        nodes.push({ kind: "status", status, count });
      }
    }

    if (summary.note) {
      nodes.push({ kind: "note", label: summary.note });
    }

    return nodes;
  }
}
