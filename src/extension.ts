import * as vscode from "vscode";
import { registerAnalystVerbs } from "./commands/analystVerbs";
import { registerCheckpoints } from "./commands/checkpoints";
import { registerEmbeddingSpaces } from "./commands/embeddingSpaces";
import { registerFind } from "./commands/find";
import { registerIndexManagement } from "./commands/indexManagement";
import { registerKnowledgeCommands } from "./commands/knowledgeCommands";
import { registerOpenViews } from "./commands/openViews";
import { registerPower } from "./commands/power";
import { registerRunQuery } from "./commands/runQuery";
import { registerSetup } from "./commands/setup";
import { registerSetupPython } from "./commands/setupPython";
import { GraphForgeSession } from "./session/graphForgeSession";
import { resetNativeCache } from "./session/nativeLoader";
import { resetPythonCache } from "./session/pythonLoader";
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
  registerFind(context, session);
  registerIndexManagement(context, session);
  registerCheckpoints(context, session);
  registerEmbeddingSpaces(context, session);
  registerPower(context, session);
  registerOpenViews(context, session, refreshTrees);
  registerSetup(context, session, refreshTrees);
  registerKnowledgeCommands(context, session, refreshTrees);
  registerSetupPython(context, session);

  void projects.refresh();

  const autoOpenFirstProject = async () => {
    if (session.project || !(await session.hasUsableRuntime())) {
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

  // Re-resolve the active runtime without a window reload after Setup UX
  // changes `nativeModulePath` (#2) or `pythonInterpreterPath`/`runtime`
  // (#12): Run Query becomes available without a full reload when possible.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("graphforge.nativeModulePath")) {
        resetNativeCache();
        session.notifyChanged();
        void autoOpenFirstProject();
      }
      if (
        event.affectsConfiguration("graphforge.pythonInterpreterPath") ||
        event.affectsConfiguration("graphforge.runtime")
      ) {
        resetPythonCache();
        session.notifyChanged();
        void autoOpenFirstProject();
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      resetPythonCache();
      session.notifyChanged();
    }),
  );

  // Best-effort: invalidate the Python probe cache when the user switches
  // interpreters via the Python extension, so Check Environment / Run Query
  // reflect the change without waiting out the cache TTL.
  void (async () => {
    const pythonExt = vscode.extensions.getExtension("ms-python.python");
    if (!pythonExt) {
      return;
    }
    try {
      const api = pythonExt.isActive ? pythonExt.exports : await pythonExt.activate();
      const disposable = api?.environments?.onDidChangeActiveEnvironmentPath?.(() => {
        resetPythonCache();
        session.notifyChanged();
      });
      if (disposable) {
        context.subscriptions.push(disposable);
      }
    } catch {
      // Extension present but API incompatible — cache TTL still applies.
    }
  })();

  void autoOpenFirstProject();
}

export function deactivate(): void {
  // disposables handled via context.subscriptions
}
