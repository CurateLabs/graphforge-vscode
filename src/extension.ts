import * as vscode from "vscode";
import { registerAnalystVerbs } from "./commands/analystVerbs";
import { registerOpenViews } from "./commands/openViews";
import { registerRunQuery } from "./commands/runQuery";
import { GraphForgeSession } from "./session/graphForgeSession";
import { KnowledgeTreeProvider } from "./views/knowledgeTree";
import { OntologyTreeProvider } from "./views/ontologyTree";
import { ProjectExplorerProvider } from "./views/projectExplorer";

export function activate(context: vscode.ExtensionContext): void {
  const session = new GraphForgeSession();
  context.subscriptions.push(session);

  const projects = new ProjectExplorerProvider(session);
  const ontology = new OntologyTreeProvider(session);
  const knowledge = new KnowledgeTreeProvider(session);
  context.subscriptions.push(projects, ontology, knowledge);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("graphforge.projects", projects),
    vscode.window.registerTreeDataProvider("graphforge.ontology", ontology),
    vscode.window.registerTreeDataProvider("graphforge.knowledge", knowledge),
  );

  const refreshTrees = () => {
    void projects.refresh();
    ontology.refresh();
    knowledge.refresh();
  };

  registerRunQuery(context, session);
  registerAnalystVerbs(context, session);
  registerOpenViews(context, session, refreshTrees);

  void projects.refresh();

  // Auto-open first detected project when binding is available
  void (async () => {
    if (!session.bindingAvailable) {
      return;
    }
    const found = await session.listProjects();
    if (found[0]) {
      try {
        await session.openProject(found[0].rootPath);
        refreshTrees();
      } catch {
        // leave unbound; user can open manually
      }
    }
  })();
}

export function deactivate(): void {
  // disposables handled via context.subscriptions
}
