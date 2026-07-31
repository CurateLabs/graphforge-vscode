import * as vscode from "vscode";
import {
  defaultsForExperienceMode,
  EXPERIENCE_MODE_CARDS,
  resolveExperienceMode,
  type ExperienceMode,
} from "../session/experienceMode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import type { HostToWebview, WebviewToHost } from "../webview/protocol";

export type GetStartedStepStatus = "pending" | "done" | "current";
export type GetStartedScreen = "welcome" | "checklist";

export interface GetStartedStep {
  id: string;
  title: string;
  detail: string;
  status: GetStartedStepStatus;
  primaryAction?: { label: string; command: string };
  secondaryAction?: { label: string; command: string };
}

export interface GetStartedState {
  screen: GetStartedScreen;
  headline: string;
  subhead: string;
  steps: GetStartedStep[];
  mode: ExperienceMode;
}

/** Focus the GraphForge activity bar and refresh Get Started state. */
export async function revealGetStarted(provider: GetStartedViewProvider): Promise<void> {
  await vscode.commands.executeCommand("workbench.view.extension.graphforge");
  await vscode.commands.executeCommand("graphforge.getStarted.focus");
  await provider.refresh();
}

/** Has the user ever completed (or skipped) the Welcome mode picker? */
function experienceModeChosen(): boolean {
  const inspected = vscode.workspace.getConfiguration("graphforge").inspect("experienceMode");
  return Boolean(
    inspected?.globalValue !== undefined ||
      inspected?.workspaceValue !== undefined ||
      inspected?.workspaceFolderValue !== undefined,
  );
}

function currentExperienceMode(): ExperienceMode {
  return resolveExperienceMode(
    vscode.workspace.getConfiguration("graphforge").get("experienceMode"),
  );
}

export class GetStartedViewProvider implements vscode.WebviewViewProvider {
  static instance: GetStartedViewProvider | undefined;

  private view: vscode.WebviewView | undefined;
  /** Set by "Change mode" to re-show Welcome without waiting for a reload. */
  private forceWelcome = false;

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
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: WebviewToHost) => {
      if (msg.type === "graphforge/ready") {
        void this.refresh();
      } else if (msg.type === "graphforge/runCommand" && msg.command) {
        void vscode.commands.executeCommand(msg.command);
      } else if (msg.type === "graphforge/selectExperienceMode") {
        void this.completeWelcome(msg.mode);
      }
    });
    void this.refresh();
  }

  /** Re-show the Welcome mode picker (e.g. from the checklist's "Change mode" link). */
  showWelcome(): void {
    this.forceWelcome = true;
    void this.refresh();
  }

  private async completeWelcome(mode: ExperienceMode): Promise<void> {
    const config = vscode.workspace.getConfiguration("graphforge");
    const defaults = defaultsForExperienceMode(mode);
    await config.update("experienceMode", mode, vscode.ConfigurationTarget.Global);
    await config.update(
      "openResultGraphOnQuery",
      defaults.openResultGraphOnQuery,
      vscode.ConfigurationTarget.Global,
    );
    this.forceWelcome = false;
    this.session.notifyChanged();
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }
    const screen: GetStartedScreen =
      this.forceWelcome || !experienceModeChosen() ? "welcome" : "checklist";
    const state = await buildGetStartedState(this.session, screen);
    const msg: HostToWebview = { type: "graphforge/getStarted", state };
    void this.view.webview.postMessage(msg);
  }

  private getHtml(webview: vscode.Webview): string {
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "graphforge.svg"),
    );
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource} 'unsafe-inline'`,
    ].join("; ");
    const cardsJson = JSON.stringify(EXPERIENCE_MODE_CARDS);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Get Started</title>
  <style>
    :root { color-scheme: light dark; --gf-accent: #4c6ef5; }
    body {
      margin: 0; padding: 16px 14px 24px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }
    .header { text-align: center; margin-bottom: 20px; }
    .logo {
      width: 40px; height: 40px; margin: 0 auto 10px;
      color: var(--gf-accent);
    }
    h1 { font-size: 15px; font-weight: 600; margin: 0 0 6px; letter-spacing: -0.01em; }
    .subhead {
      font-size: 12px; line-height: 1.45;
      color: var(--vscode-descriptionForeground); margin: 0;
    }
    .banner {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
      border-radius: 8px; padding: 8px 10px; margin-bottom: 14px;
      background: color-mix(in srgb, var(--gf-accent) 12%, var(--vscode-editor-background));
      font-size: 11px;
    }
    .banner .mode-label { font-weight: 600; }
    .banner button.link { padding: 0; font-size: 11px; }
    .cards { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
    .card {
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
      border-radius: 10px; padding: 12px; cursor: pointer;
      background: var(--vscode-editor-background);
      text-align: left;
    }
    .card.selected {
      border-color: var(--gf-accent);
      box-shadow: 0 0 0 1px var(--gf-accent) inset;
    }
    .card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .radio {
      flex-shrink: 0; width: 14px; height: 14px; border-radius: 50%;
      border: 2px solid var(--vscode-panel-border, rgba(128,128,128,0.6));
    }
    .card.selected .radio { border-color: var(--gf-accent); background: var(--gf-accent); }
    .card-title { font-size: 13px; font-weight: 600; margin: 0; }
    .card-tagline {
      font-size: 11px; color: var(--vscode-descriptionForeground); margin: 0 0 8px;
    }
    .card ul { margin: 0; padding-left: 18px; }
    .card li {
      font-size: 11px; line-height: 1.5; color: var(--vscode-descriptionForeground);
    }
    .step {
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
      border-radius: 8px;
      padding: 12px 12px 10px;
      margin-bottom: 10px;
      background: var(--vscode-editor-background);
    }
    .step.done { opacity: 0.72; }
    .step-head { display: flex; align-items: flex-start; gap: 10px; }
    .badge {
      flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 600;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .step.done .badge { background: var(--gf-accent); color: #fff; }
    .step.current .badge {
      border: 2px solid var(--gf-accent);
      background: transparent;
      color: var(--gf-accent);
    }
    .step-title { font-size: 13px; font-weight: 600; margin: 0 0 4px; }
    .step-detail {
      font-size: 11px; line-height: 1.4;
      color: var(--vscode-descriptionForeground); margin: 0;
    }
    .actions { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px; }
    button {
      font-family: var(--vscode-font-family);
      font-size: 11px; border: none; border-radius: 4px;
      padding: 5px 10px; cursor: pointer;
    }
    button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.primary:hover { background: var(--vscode-button-hoverBackground); }
    button.primary.full { width: 100%; padding: 8px 10px; font-weight: 600; }
    button.secondary {
      background: var(--vscode-button-secondaryBackground, transparent);
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
    }
    .footer {
      margin-top: 14px; text-align: center;
    }
    button.link {
      background: none; color: var(--vscode-textLink-foreground);
      text-decoration: underline; padding: 4px;
    }
  </style>
</head>
<body>
  <div class="header">
    <img class="logo" src="${logoUri}" alt="" />
    <h1 id="headline">Get started with GraphForge</h1>
    <p class="subhead" id="subhead"></p>
  </div>
  <div id="banner"></div>
  <div id="cards"></div>
  <div id="continue"></div>
  <div id="steps"></div>
  <div class="footer">
    <button class="link" id="refresh">Check Environment</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const CARDS = ${cardsJson};
    let selectedMode = 'guided';

    document.getElementById('refresh').addEventListener('click', () =>
      vscode.postMessage({ type: 'graphforge/runCommand', command: 'graphforge.checkEnvironment' })
    );

    function renderBanner(mode) {
      const bannerEl = document.getElementById('banner');
      bannerEl.innerHTML =
        '<div class="banner">' +
          '<span><span class="mode-label">' + (mode === 'autonomous' ? 'Autonomous' : 'Guided') + '</span> mode</span>' +
          '<button class="link" id="change-mode">Change mode</button>' +
        '</div>';
      document.getElementById('change-mode').addEventListener('click', () =>
        vscode.postMessage({ type: 'graphforge/runCommand', command: 'graphforge.chooseExperienceMode' })
      );
    }

    function renderCards(mode) {
      selectedMode = mode;
      const cardsEl = document.getElementById('cards');
      cardsEl.innerHTML = CARDS.map((card) =>
        '<div class="card' + (card.mode === selectedMode ? ' selected' : '') + '" data-mode="' + card.mode + '">' +
          '<div class="card-head"><div class="radio"></div><p class="card-title">' + card.title + '</p></div>' +
          '<p class="card-tagline">' + card.tagline + '</p>' +
          '<ul>' + card.bullets.map((b) => '<li>' + b + '</li>').join('') + '</ul>' +
        '</div>'
      ).join('');
      cardsEl.querySelectorAll('.card').forEach((el) => {
        el.addEventListener('click', () => {
          selectedMode = el.getAttribute('data-mode');
          cardsEl.querySelectorAll('.card').forEach((c) =>
            c.classList.toggle('selected', c.getAttribute('data-mode') === selectedMode)
          );
        });
      });
      document.getElementById('continue').innerHTML =
        '<button class="primary full" id="continue-btn">Continue</button>';
      document.getElementById('continue-btn').addEventListener('click', () =>
        vscode.postMessage({ type: 'graphforge/selectExperienceMode', mode: selectedMode })
      );
    }

    function renderSteps(steps) {
      const stepsEl = document.getElementById('steps');
      stepsEl.innerHTML = steps.map((step, i) => {
        const actions = [];
        if (step.primaryAction) {
          actions.push('<button class="primary" data-cmd="' + step.primaryAction.command + '">' +
            step.primaryAction.label + '</button>');
        }
        if (step.secondaryAction) {
          actions.push('<button class="secondary" data-cmd="' + step.secondaryAction.command + '">' +
            step.secondaryAction.label + '</button>');
        }
        return '<div class="step ' + step.status + '">' +
          '<div class="step-head">' +
            '<div class="badge">' + (step.status === 'done' ? '✓' : (i + 1)) + '</div>' +
            '<div><p class="step-title">' + step.title + '</p>' +
            '<p class="step-detail">' + step.detail + '</p></div>' +
          '</div>' +
          (actions.length ? '<div class="actions">' + actions.join('') + '</div>' : '') +
        '</div>';
      }).join('');
      stepsEl.querySelectorAll('[data-cmd]').forEach((btn) => {
        btn.addEventListener('click', () =>
          vscode.postMessage({ type: 'graphforge/runCommand', command: btn.getAttribute('data-cmd') })
        );
      });
    }

    function render(state) {
      document.getElementById('headline').textContent = state.headline;
      document.getElementById('subhead').textContent = state.subhead;
      const isWelcome = state.screen === 'welcome';
      document.getElementById('banner').style.display = isWelcome ? 'none' : '';
      document.getElementById('cards').style.display = isWelcome ? '' : 'none';
      document.getElementById('continue').style.display = isWelcome ? '' : 'none';
      document.getElementById('steps').style.display = isWelcome ? 'none' : '';
      if (isWelcome) {
        renderCards(state.mode);
      } else {
        renderBanner(state.mode);
        renderSteps(state.steps);
      }
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg && msg.type === 'graphforge/getStarted') render(msg.state);
    });
    vscode.postMessage({ type: 'graphforge/ready' });
  </script>
</body>
</html>`;
  }
}

export async function buildGetStartedState(
  session: GraphForgeSession,
  screen: GetStartedScreen = "checklist",
): Promise<GetStartedState> {
  const mode = currentExperienceMode();

  if (screen === "welcome") {
    return {
      screen,
      headline: "Welcome to GraphForge",
      subhead: "Choose how you want to work. You can change this anytime from Get Started.",
      steps: [],
      mode,
    };
  }

  const snapshot = await session.environmentSnapshot();
  const project = session.project;
  const runtimeReady = await session.hasUsableRuntime();
  const projectReady = Boolean(project);
  const nodeAvailable = snapshot.node.available;
  const pythonAvailable = snapshot.python.available;
  const activeRuntime = session.activeRuntime;

  const nodeLine = nodeAvailable ? "Node binding ready" : "Node binding not linked";
  const pythonLine = pythonAvailable
    ? `Python ready${snapshot.python.graphforgeVersion ? ` (graphforge ${snapshot.python.graphforgeVersion})` : ""}`
    : "Python runtime not configured";

  const runtimeStep: GetStartedStep = {
    id: "runtime",
    title: "Set up a runtime",
    detail: runtimeReady
      ? `Active: ${activeRuntime ?? snapshot.active ?? "auto"}. ${nodeLine}; ${pythonLine}.`
      : `${nodeLine}. ${pythonLine}. Link @graphforge/node or install graphforge with uv.`,
    status: runtimeReady ? "done" : "current",
    primaryAction: runtimeReady
      ? undefined
      : { label: "Setup Native (Node)", command: "graphforge.setupNativeBinding" },
    secondaryAction: runtimeReady
      ? { label: "Setup Python", command: "graphforge.setupPythonBinding" }
      : { label: "Setup Python", command: "graphforge.setupPythonBinding" },
  };

  const projectStep: GetStartedStep = {
    id: "project",
    title: "Open or create a project",
    detail: projectReady
      ? `Working in ${project?.name ?? "project"}${project?.rootPath ? ` (${project.rootPath})` : ""}.`
      : "Pick a folder with a FORMAT marker, or initialize an empty directory.",
    status: projectReady ? "done" : runtimeReady ? "current" : "pending",
    primaryAction: projectReady
      ? { label: "Open Project", command: "graphforge.openProject" }
      : runtimeReady
        ? { label: "Open Project", command: "graphforge.openProject" }
        : undefined,
    secondaryAction: projectReady
      ? undefined
      : runtimeReady
        ? { label: "Initialize", command: "graphforge.initializeProjectHere" }
        : undefined,
  };

  const queryStep: GetStartedStep = {
    id: "query",
    title: "Run your first query",
    detail: projectReady
      ? "Open a .cypher file or run a query from the command palette."
      : "Available once a project is open and a runtime is active.",
    status: projectReady && runtimeReady ? "current" : "pending",
    primaryAction:
      projectReady && runtimeReady
        ? { label: "Run Query", command: "graphforge.runQuery" }
        : undefined,
  };

  let headline = "Get started with GraphForge";
  let subhead = "Guided setup — no stack traces here. Details live in Check Environment.";
  if (projectReady && runtimeReady) {
    headline = "You're ready to explore";
    subhead = "Run Cypher, analyst verbs, and browse ontology from the GraphForge sidebar.";
  } else if (!runtimeReady) {
    subhead = "Link a Node or Python runtime to begin. Full diagnostics are in Check Environment.";
  } else if (!projectReady) {
    subhead = "Runtime is ready — open or initialize a GraphForge project next.";
  }

  return {
    screen,
    headline,
    subhead,
    steps: [runtimeStep, projectStep, queryStep],
    mode,
  };
}
