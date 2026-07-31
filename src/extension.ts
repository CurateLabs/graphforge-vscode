import * as vscode from "vscode";
import { registerAnalystVerbs } from "./commands/analystVerbs";
import { registerOpenViews } from "./commands/openViews";
import { registerRunQuery } from "./commands/runQuery";
import { registerSetup } from "./commands/setup";
import { GraphForgeSession } from "./session/graphForgeSession";
import { resetNativeCache } from "./session/nativeLoader";
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
  registerSetup(context, session, refreshTrees);

  void projects.refresh();

  const autoOpenFirstProject = async () => {
    if (!session.bindingAvailable || session.project) {
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
  };

  // Re-resolve the native binding without a window reload after Setup UX
  // changes `nativeModulePath` (issue #2 acceptance: Run Query becomes
  // available without a full reload when possible).
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("graphforge.nativeModulePath")) {
        resetNativeCache();
        session.notifyChanged();
        void autoOpenFirstProject();
      }
    }),
  );

  void autoOpenFirstProject();
}

export function deactivate(): void {
  // disposables handled via context.subscriptions
}
