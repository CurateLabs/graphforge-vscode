import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import { readWorkspaceOntology } from "../session/projectDetector";

type Node =
  | { kind: "mode"; label: string }
  | { kind: "group"; label: string; children: Node[] }
  | { kind: "item"; label: string; description?: string }
  | { kind: "action"; label: string; command: string; icon: string };

export class OntologyTreeProvider
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
    item.description = element.kind === "item" ? element.description : undefined;
    item.iconPath = new vscode.ThemeIcon(
      element.kind === "mode" ? "shield" : "symbol-class",
    );
    if (element.kind === "mode") {
      item.command = {
        command: "graphforge.showOntology",
        title: "Show Ontology Viewer",
      };
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

    const project = this.session.project;
    if (!project) {
      return [
        {
          kind: "mode",
          label: "No project open",
        },
        {
          kind: "action",
          label: "Open Project…",
          command: "graphforge.openProject",
          icon: "folder-opened",
        },
      ];
    }

    const mode = await this.session.ontologyMode();
    const ws = readWorkspaceOntology(
      project.rootPath,
      project.current?.generation_uuid,
    );
    const ontology = ws?.canonical_ontology ?? this.session.workspaceOntology();

    const entities = (ontology?.entity_types ?? []).map(
      (e): Node => ({
        kind: "item",
        label: e.name,
        description: e.parent ? `⊂ ${e.parent}` : e.abstract ? "abstract" : undefined,
      }),
    );
    const relations = (ontology?.relation_types ?? []).map(
      (r): Node => ({
        kind: "item",
        label: r.name,
        description: `${r.src} → ${r.dst}`,
      }),
    );

    const loadAction: Node = {
      kind: "action",
      label: "Load Ontology…",
      command: "graphforge.loadOntology",
      icon: "cloud-upload",
    };

    if (!ontology) {
      // Exploratory mode with no ontology loaded yet is a valid, common state —
      // not an error — so the empty state must explain that and offer the fix.
      return [
        { kind: "mode", label: `Mode: ${mode}` },
        {
          kind: "item",
          label: "No ontology loaded yet",
          description:
            mode === "exploratory"
              ? "Exploratory mode works without one — load one anytime to add structure."
              : "Load one to see entity/relation types here.",
        },
        loadAction,
      ];
    }

    return [
      { kind: "mode", label: `Mode: ${mode}` },
      {
        kind: "group",
        label: `Entity types (${entities.length})`,
        children: entities.length
          ? entities
          : [{ kind: "item", label: "(none — exploratory)" }],
      },
      {
        kind: "group",
        label: `Relation types (${relations.length})`,
        children: relations.length
          ? relations
          : [{ kind: "item", label: "(none)" }],
      },
      loadAction,
    ];
  }
}
