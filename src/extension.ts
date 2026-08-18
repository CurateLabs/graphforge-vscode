import * as vscode from "vscode";
import { registerAgentCommands } from "./commands/agent";
import { registerAnalystVerbs } from "./commands/analystVerbs";
import { registerCheckpoints } from "./commands/checkpoints";
import { registerEmbeddingSpaces } from "./commands/embeddingSpaces";
import { registerFind } from "./commands/find";
import { registerIndexManagement } from "./commands/indexManagement";
import { registerKnowledgeCommands } from "./commands/knowledgeCommands";
import { registerOpenSampleProject } from "./commands/openSampleProject";
import { registerOpenViews } from "./commands/openViews";
import { registerPower } from "./commands/power";
import { registerProjectArtifacts } from "./commands/projectArtifacts";
import { registerRunCli } from "./commands/runCli";
import { registerSetup } from "./commands/setup";
import { registerSetupPython } from "./commands/setupPython";
import { GraphForgeSession } from "./session/graphForgeSession";
import { resetNativeCache } from "./session/nativeLoader";
import { resetPythonCache } from "./session/pythonLoader";
import { firstPartyModules } from "./modules/firstParty";
import { ModuleManager } from "./modules/moduleManager";
import { KnowledgeTreeProvider } from "./views/knowledgeTree";
import { GetStartedViewProvider } from "./views/getStartedView";
import { OntologyTreeProvider } from "./views/ontologyTree";
import { ProjectExplorerProvider } from "./views/projectExplorer";
import { EntityInspectPanel } from "./webview/entityInspectPanel";
import { ModuleManagerPanel } from "./webview/moduleManagerPanel";
import { visualizationInstances } from "./webview/visualizationInstanceRegistry";
import {
  RESULTS_VIEW_ID,
  ResultTableViewProvider,
} from "./views/resultTableView";

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const session = new GraphForgeSession();
  context.subscriptions.push(session, { dispose: () => visualizationInstances.dispose() });

  const projects = new ProjectExplorerProvider(session);
  const ontology = new OntologyTreeProvider(session);
  const knowledge = new KnowledgeTreeProvider(session);
  EntityInspectPanel.configure(session);
  const results = new ResultTableViewProvider(context.extensionUri, session);
  context.subscriptions.push(projects, ontology, knowledge, results);
  const modules = new ModuleManager(context, session, results);
  context.subscriptions.push(modules);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("graphforge.projects", projects),
    vscode.window.registerTreeDataProvider("graphforge.ontology", ontology),
    vscode.window.registerTreeDataProvider("graphforge.knowledge", knowledge),
    vscode.window.registerWebviewViewProvider(
      "graphforge.getStarted",
      new GetStartedViewProvider(context.extensionUri, session),
    ),
    vscode.window.registerWebviewViewProvider(RESULTS_VIEW_ID, results, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("graphforge.showResultsTable", () =>
      results.reveal(),
    ),
  );

  const refreshTrees = () => {
    void projects.refresh();
    ontology.refresh();
    knowledge.refresh();
  };

  registerProjectArtifacts(context, session, results);
  registerAgentCommands(context, session);
  registerAnalystVerbs(context, session, results);
  registerFind(context, session, results);
  registerIndexManagement(context, session);
  registerCheckpoints(context, session);
  registerEmbeddingSpaces(context, session);
  registerPower(context, session);
  registerRunCli(context, session);
  registerOpenViews(context, session, refreshTrees);
  registerOpenSampleProject(context, session, refreshTrees);
  registerSetup(context, session, refreshTrees);
  registerKnowledgeCommands(context, session, refreshTrees);
  registerSetupPython(context, session);

  context.subscriptions.push(
    vscode.commands.registerCommand("graphforge.manageModules", () =>
      ModuleManagerPanel.show(context.extensionUri, modules),
    ),
    vscode.commands.registerCommand("graphforge.installModuleFromFile", async () => {
      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: true,
        canSelectMany: false,
        filters: { "GraphForge modules": ["json"] },
        openLabel: "Install module",
        title: "Select a .gfmodule.json file or module folder",
      });
      if (!selected?.[0]) return { cancelled: true };
      const installed = await modules.installFromUri(selected[0]);
      if (!installed) return { cancelled: true };
      ModuleManagerPanel.show(context.extensionUri, modules);
      return modules.list();
    }),
    vscode.commands.registerCommand("graphforge.refreshModules", async () => {
      await modules.refreshGraphForgeCatalog();
      return modules.list();
    }),
  );
  await modules.initialize(firstPartyModules);

  let catalogProject = session.project?.rootPath;
  context.subscriptions.push(
    session.onDidChange(() => {
      const nextProject = session.project?.rootPath;
      if (nextProject !== catalogProject) {
        catalogProject = nextProject;
        void modules.refreshGraphForgeCatalog();
      }
    }),
  );

  void projects.refresh();

  // Re-resolve the active runtime without a window reload after Setup UX
  // changes `nativeModulePath` (#2) or `pythonInterpreterPath`/`runtime`
  // (#12): Run Query becomes available without a full reload when possible.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("graphforge.nativeModulePath")) {
        resetNativeCache();
        session.notifyChanged();
      }
      if (
        event.affectsConfiguration("graphforge.pythonInterpreterPath") ||
        event.affectsConfiguration("graphforge.runtime")
      ) {
        resetPythonCache();
        session.notifyChanged();
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

  void modules.refreshGraphForgeCatalog();
  setTimeout(() => void modules.activatePending(), 0);
}

export function deactivate(): void {
  // disposables handled via context.subscriptions
}
