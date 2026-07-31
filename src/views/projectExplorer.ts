import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import type { DetectedProject } from "../session/types";

type TreeNode =
  | { kind: "message"; label: string; description?: string }
  | { kind: "project"; project: DetectedProject }
  | { kind: "section"; label: string; project: DetectedProject; section: "labels" | "rels" | "gen" }
  | { kind: "label"; label: string }
  | { kind: "rel"; label: string };

export class ProjectExplorerProvider
  implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable
{
  private readonly _onDidChange = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private projects: DetectedProject[] = [];
  private readonly sub: vscode.Disposable;

  constructor(private readonly session: GraphForgeSession) {
    this.sub = session.onDidChange(() => void this.refresh());
  }

  dispose(): void {
    this.sub.dispose();
    this._onDidChange.dispose();
  }

  async refresh(): Promise<void> {
    this.projects = await this.session.listProjects();
    this._onDidChange.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    switch (element.kind) {
      case "message": {
        const item = new vscode.TreeItem(
          element.label,
          vscode.TreeItemCollapsibleState.None,
        );
        item.description = element.description;
        item.iconPath = new vscode.ThemeIcon("info");
        return item;
      }
      case "project": {
        const active =
          this.session.project?.rootPath === element.project.rootPath;
        const item = new vscode.TreeItem(
          element.project.name,
          vscode.TreeItemCollapsibleState.Expanded,
        );
        item.description = active ? "active" : element.project.rootPath;
        item.iconPath = new vscode.ThemeIcon(active ? "database" : "folder");
        item.contextValue = "graphforge.project";
        item.command = {
          command: "graphforge.openProject",
          title: "Open",
          arguments: [element.project.rootPath],
        };
        return item;
      }
      case "section": {
        const item = new vscode.TreeItem(
          element.label,
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.iconPath = new vscode.ThemeIcon(
          element.section === "labels"
            ? "symbol-class"
            : element.section === "rels"
              ? "arrow-both"
              : "git-commit",
        );
        return item;
      }
      case "label":
      case "rel": {
        const item = new vscode.TreeItem(
          element.label,
          vscode.TreeItemCollapsibleState.None,
        );
        item.iconPath = new vscode.ThemeIcon(
          element.kind === "label" ? "symbol-class" : "arrow-both",
        );
        return item;
      }
    }
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      if (!(await this.session.hasUsableRuntime())) {
        return [
          {
            kind: "message",
            label: "No runtime available",
            description: "Setup Native Binding or Setup Python Binding",
          },
        ];
      }
      if (this.projects.length === 0) {
        await this.refresh();
      }
      if (this.projects.length === 0) {
        return [
          {
            kind: "message",
            label: "No GraphForge projects detected",
            description: "FORMAT must be graphforge-project/v1",
          },
        ];
      }
      return this.projects.map((project) => ({ kind: "project" as const, project }));
    }

    if (element.kind === "project") {
      const nodes: TreeNode[] = [
        {
          kind: "section",
          label: "Generation",
          project: element.project,
          section: "gen",
        },
        {
          kind: "section",
          label: "Labels",
          project: element.project,
          section: "labels",
        },
        {
          kind: "section",
          label: "Relationship types",
          project: element.project,
          section: "rels",
        },
      ];
      return nodes;
    }

    if (element.kind === "section") {
      if (element.section === "gen") {
        const uuid = element.project.current?.generation_uuid ?? "(no CURRENT)";
        return [{ kind: "message", label: uuid }];
      }
      const active = this.session.project?.rootPath === element.project.rootPath;
      if (!active) {
        return [
          {
            kind: "message",
            label: "Open project to load catalog",
          },
        ];
      }
      if (element.section === "labels") {
        const labels = await this.session.labels();
        return labels.map((label) => ({ kind: "label" as const, label }));
      }
      const relationshipTypes = await this.session.relationshipTypes();
      return relationshipTypes.map((label) => ({ kind: "rel" as const, label }));
    }

    return [];
  }
}
