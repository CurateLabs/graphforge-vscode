import * as crypto from "node:crypto";
import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import type { HostToWebview, WebviewToHost } from "../webview/protocol";
import {
  buildChecklistSteps,
  selectJourneyArtifacts,
  type GetStartedStepModel,
} from "./getStartedContent";
import { isQuickstartSamplePath } from "../session/quickstartSample";
import {
  scanProjectArtifacts,
  type ProjectArtifactIndex,
} from "../session/projectArtifacts";

export type GetStartedStepStatus = "pending" | "done" | "current";
export type GetStartedPage = "hub" | "query" | "visualize";

export type GetStartedStep = GetStartedStepModel;

export interface GetStartedState {
  headline: string;
  subhead: string;
  steps: GetStartedStep[];
  artifacts?: ProjectArtifactIndex;
  page: GetStartedPage;
}

/** Focus the GraphForge activity bar and refresh Get Started state. */
export async function revealGetStarted(provider: GetStartedViewProvider): Promise<void> {
  provider.showPage("hub");
  await vscode.commands.executeCommand("workbench.view.extension.graphforge");
  await vscode.commands.executeCommand("graphforge.getStarted.focus");
  await provider.refresh();
}

/** Focus Get Started and switch to a title-action-selected control surface. */
export async function revealGetStartedPage(
  provider: GetStartedViewProvider,
  page: GetStartedPage,
): Promise<void> {
  provider.showPage(page);
  await vscode.commands.executeCommand("workbench.view.extension.graphforge");
  await vscode.commands.executeCommand("graphforge.getStarted.focus");
  await provider.refresh();
}

export class GetStartedViewProvider implements vscode.WebviewViewProvider {
  static instance: GetStartedViewProvider | undefined;

  private view: vscode.WebviewView | undefined;
  private page: GetStartedPage = "hub";

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly session: GraphForgeSession,
  ) {
    GetStartedViewProvider.instance = this;
    session.onDidChange(() => {
      void this.refresh();
    });
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "dist", "webview-ui"),
        vscode.Uri.joinPath(this.extensionUri, "media"),
      ],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: WebviewToHost) => {
      if (msg.type === "graphforge/ready") {
        void this.refresh();
      } else if (msg.type === "graphforge/runCommand" && msg.command) {
        const args = Array.isArray(msg.args) ? msg.args : [];
        void (async () => {
          try {
            const outcome = await vscode.commands.executeCommand<unknown>(msg.command, ...args);
            const outcomeRecord =
              outcome && typeof outcome === "object"
                ? outcome as Record<string, unknown>
                : undefined;
            const lifecycle =
              outcomeRecord?.lifecycle && typeof outcomeRecord.lifecycle === "object"
                ? outcomeRecord.lifecycle as Record<string, unknown>
                : undefined;
            const error = outcomeRecord?.error ??
              (lifecycle?.type === "graphforge/renderFailed"
                ? lifecycle.message ?? "The renderer failed before it became ready."
                : undefined);
            const rendererReady = lifecycle?.type === "graphforge/renderReady";
            await webviewView.webview.postMessage({
              type: "graphforge/commandStatus",
              status: error ? "error" : "success",
              message: error
                ? String(error)
                : rendererReady
                  ? `${String(lifecycle?.renderer ?? "Visualization")} renderer ready.`
                  : "Action complete.",
            } satisfies HostToWebview);
            if (!error) await this.refresh();
          } catch (error) {
            await webviewView.webview.postMessage({
              type: "graphforge/commandStatus",
              status: "error",
              message: error instanceof Error ? error.message : String(error),
            } satisfies HostToWebview);
          }
        })();
      }
    });
    void this.refresh();
  }

  showPage(page: GetStartedPage): void {
    this.page = page;
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }
    const state = await buildGetStartedState(this.session, this.page);
    const msg: HostToWebview = { type: "graphforge/getStarted", state };
    void this.view.webview.postMessage(msg);
  }

  private getHtml(webview: vscode.Webview): string {
    const assetsRoot = vscode.Uri.joinPath(this.extensionUri, "dist", "webview-ui");
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, "getStarted.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, "getStarted.css"));
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "graphforge.svg"),
    );
    const nonce = crypto.randomBytes(16).toString("base64url");
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Get Started</title>
</head>
<body>
  <div id="app" data-logo-uri="${logoUri}"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

export async function buildGetStartedState(
  session: GraphForgeSession,
  page: GetStartedPage = "hub",
): Promise<GetStartedState> {
  const snapshot = await session.environmentSnapshot();
  const project = session.project;
  const runtimeReady = await session.hasUsableRuntime();
  const projectReady = Boolean(project);
  const nodeAvailable = snapshot.node.available;
  const pythonAvailable = snapshot.python.available;
  const activeRuntime = session.activeRuntime;
  const hasLastResult = session.hasLastResult;
  const isSampleProject = Boolean(
    project?.rootPath && isQuickstartSamplePath(project.rootPath),
  );
  const artifacts = project?.rootPath
    ? scanProjectArtifacts(project.rootPath)
    : {
        queries: [],
        queryTemplates: [],
        notebooks: [],
        results: [],
        visualizations: [],
        mutations: [],
      };
  const sampleQueryPath = isSampleProject
    ? (artifacts.queryTemplates[0] ?? artifacts.queries[0])?.path
    : undefined;
  const { resultPath, visualizationPath } = selectJourneyArtifacts(
    isSampleProject,
    artifacts.results,
    artifacts.visualizations,
    vscode.workspace
      .getConfiguration("graphforge")
      .get<string>("resultGraph.renderer", "cytoscape"),
  );

  const nodeLine = nodeAvailable ? "Node binding ready" : "Node binding not linked";
  const pythonLine = pythonAvailable
    ? `Python ready${snapshot.python.graphforgeVersion ? ` (graphforge ${snapshot.python.graphforgeVersion})` : ""}`
    : "Python is optional for scripts and notebooks";

  const steps = buildChecklistSteps({
    runtimeReady,
    projectReady,
    hasLastResult,
    hasResultArtifact: Boolean(resultPath),
    hasSavedVisualization: Boolean(visualizationPath),
    isSampleProject,
    projectName: project?.name,
    activeRuntime,
    nodeLine,
    pythonLine,
    projectKind: snapshot.projectKind,
    snapshotActive: snapshot.active,
    sampleQueryPath,
    resultPath,
    visualizationPath,
  });

  let headline = "Build your first graph view";
  let subhead =
    "Follow one visible path from environment to saved query, result, and visualization.";
  if (page === "hub" && steps.length > 0 && steps.every((step) => step.status === "done")) {
    headline = "Your GraphForge project is ready";
    subhead = "Open a saved view, inspect the durable result, or continue in Python.";
  } else if (page === "query") {
    headline = "Query";
    subhead = projectReady
      ? "Draft Cypher, save reusable project templates, and reopen result history."
      : "Open a project to draft, save, and run query templates.";
  } else if (page === "visualize") {
    headline = "Visualize";
    subhead = projectReady
      ? "Create saved graph or figure views from durable project results."
      : "Open a project and run a query before creating a visualization.";
  }

  return {
    headline,
    subhead,
    steps,
    artifacts,
    page,
  };
}
