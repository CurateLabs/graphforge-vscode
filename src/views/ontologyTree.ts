import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import { readWorkspaceOntology } from "../session/projectDetector";

type Node =
  | { kind: "mode"; label: string }
  | { kind: "group"; label: string; children: Node[] }
  | { kind: "item"; label: string; description?: string };

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
    ];
  }
}
