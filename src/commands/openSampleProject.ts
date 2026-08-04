import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import { isGraphForgeProject } from "../session/projectDetector";
import {
  isEmptyDir,
  isQuickstartSamplePath,
  loadQuickstartDataset,
  materializeQuickstartProjectFiles,
  QUICKSTART_NOTEBOOK_REL,
  QUICKSTART_STREAMLIT_REL,
  repairQuickstartProjectFiles,
  resolveQuickstartPath,
  writeQuickstartMarker,
} from "../session/quickstartSample";
import { readProjectQuery } from "../session/projectArtifacts";
import type { DetectedProject } from "../session/types";
import type { CommandOutcome } from "./shared";
import {
  presentError,
  reportEngineError,
  withEngineProgress,
} from "./shared";

export type OpenSampleProjectArgs = {
  /** Absolute (or resolvable) path for the sample project directory. */
  path?: string;
  /** When true, re-seed even if a quickstart marker already exists. */
  force?: boolean;
};

export type OpenSampleProjectSuccess = {
  path: string;
  project: DetectedProject;
  seeded: boolean;
  repaired?: string[];
};

export type OpenSampleNotebookSuccess = {
  /** Absolute path of the notebook opened in the editor. */
  path: string;
  /** Absolute project root that contains the notebook and its data. */
  projectPath: string;
  relativePath: string;
};

export type OpenSampleStreamlitSuccess = {
  /** Absolute path of the Streamlit app opened in the editor. */
  path: string;
  /** Absolute project root that contains the app and its data. */
  projectPath: string;
  relativePath: string;
  command: string;
};

/** Palette/Get Started calls with no args; agents/e2e pass an object. */
function isInteractiveCall(args?: OpenSampleProjectArgs): boolean {
  return args === undefined;
}

function rmrf(target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
}

async function openExisting(
  session: GraphForgeSession,
  target: string,
  refreshTrees: () => void,
  repaired: string[] = [],
): Promise<CommandOutcome<OpenSampleProjectSuccess>> {
  try {
    await session.openProject(target);
    const project = session.project;
    if (!project) {
      const error = "Sample project opened but session has no active project.";
      presentError(`GraphForge: ${error}`);
      return { error, code: "SAMPLE_OPEN_FAILED" };
    }
    refreshTrees();
    return {
      path: target,
      project,
      seeded: false,
      ...(repaired.length > 0 ? { repaired } : {}),
    };
  } catch (err) {
    return reportEngineError("open sample project failed", err);
  }
}

export function registerOpenSampleProject(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
  refreshTrees: () => void,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "graphforge.openSampleNotebook",
      async (): Promise<CommandOutcome<OpenSampleNotebookSuccess>> => {
        const projectRoot = session.project?.rootPath;
        if (!projectRoot || !isQuickstartSamplePath(projectRoot)) {
          const error = "Open the air-routes sample before opening its Python notebook.";
          presentError(`GraphForge: ${error}`);
          return {
            error,
            code: "SAMPLE_NOTEBOOK_PROJECT_REQUIRED",
            nextAction: "graphforge.openSampleProject",
          };
        }
        const notebookPath = path.join(projectRoot, QUICKSTART_NOTEBOOK_REL);
        if (!fs.existsSync(notebookPath)) {
          try {
            const dataset = loadQuickstartDataset(context.extensionPath);
            repairQuickstartProjectFiles(projectRoot, dataset);
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            presentError(`GraphForge: ${error}`);
            return { error, code: "SAMPLE_NOTEBOOK_MISSING", nextAction: "graphforge.openSampleProject" };
          }
        }
        if (!fs.existsSync(notebookPath)) {
          const error = `Sample notebook is unavailable: ${QUICKSTART_NOTEBOOK_REL}`;
          presentError(`GraphForge: ${error}`);
          return { error, code: "SAMPLE_NOTEBOOK_MISSING", nextAction: "graphforge.openSampleProject" };
        }
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(notebookPath));
        void vscode.window.showInformationMessage(`Opened Python notebook: ${notebookPath}`);
        return {
          path: notebookPath,
          projectPath: projectRoot,
          relativePath: QUICKSTART_NOTEBOOK_REL.split(path.sep).join("/"),
        };
      },
    ),

    vscode.commands.registerCommand(
      "graphforge.openSampleStreamlit",
      async (): Promise<CommandOutcome<OpenSampleStreamlitSuccess>> => {
        const projectRoot = session.project?.rootPath;
        if (!projectRoot || !isQuickstartSamplePath(projectRoot)) {
          const error = "Open the air-routes sample before opening its Streamlit app.";
          presentError(`GraphForge: ${error}`);
          return {
            error,
            code: "SAMPLE_STREAMLIT_PROJECT_REQUIRED",
            nextAction: "graphforge.openSampleProject",
          };
        }
        const appPath = path.join(projectRoot, QUICKSTART_STREAMLIT_REL);
        if (!fs.existsSync(appPath)) {
          try {
            const dataset = loadQuickstartDataset(context.extensionPath);
            repairQuickstartProjectFiles(projectRoot, dataset);
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            presentError(`GraphForge: ${error}`);
            return { error, code: "SAMPLE_STREAMLIT_MISSING", nextAction: "graphforge.openSampleProject" };
          }
        }
        if (!fs.existsSync(appPath)) {
          const error = `Sample Streamlit app is unavailable: ${QUICKSTART_STREAMLIT_REL}`;
          presentError(`GraphForge: ${error}`);
          return { error, code: "SAMPLE_STREAMLIT_MISSING", nextAction: "graphforge.openSampleProject" };
        }
        const command = `uv run --with streamlit --with graphforge --with pandas --with plotly streamlit run ${appPath}`;
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(appPath));
        void vscode.window.showInformationMessage(
          `Opened Streamlit app: ${appPath}. Run: ${command}`,
        );
        return {
          path: appPath,
          projectPath: projectRoot,
          relativePath: QUICKSTART_STREAMLIT_REL.split(path.sep).join("/"),
          command,
        };
      },
    ),

    vscode.commands.registerCommand("graphforge.closeProject", async () => {
      await session.closeProject();
      refreshTrees();
      return { closed: true as const };
    }),

    vscode.commands.registerCommand(
      "graphforge.openSampleProject",
      async (
        args?: OpenSampleProjectArgs,
      ): Promise<CommandOutcome<OpenSampleProjectSuccess>> => {
        if (!(await session.hasUsableRuntime())) {
          const error =
            "No usable GraphForge runtime. Set up Node or Python before opening the sample.";
          presentError(`GraphForge: ${error}`);
          return {
            error,
            code: "RUNTIME_UNAVAILABLE",
            nextAction: "graphforge.setupNativeBinding",
          };
        }

        const target = resolveQuickstartPath({ path: args?.path });
        const force = Boolean(args?.force);
        const interactive = isInteractiveCall(args);

        const exists = fs.existsSync(target);
        const isProject = exists && isGraphForgeProject(target);
        const isSample = isProject && isQuickstartSamplePath(target);

        if (isSample && !force) {
          try {
            const dataset = loadQuickstartDataset(context.extensionPath);
            const repaired = repairQuickstartProjectFiles(target, dataset);
            return openExisting(session, target, refreshTrees, repaired);
          } catch (err) {
            return reportEngineError("repair sample project failed", err);
          }
        }

        if (exists && !isEmptyDir(target)) {
          if (interactive) {
            const choice = await vscode.window.showWarningMessage(
              isSample
                ? `Recreate the GraphForge quickstart sample at ${target}? Existing data will be replaced.`
                : `"${path.basename(target)}" already exists. Replace it with the GraphForge quickstart sample?`,
              { modal: true },
              "Replace",
            );
            if (choice !== "Replace") {
              return { cancelled: true };
            }
          } else if (!force && !isSample) {
            const error =
              "Sample path already exists and is not a quickstart project. Pass { force: true } to replace.";
            presentError(`GraphForge: ${error}`);
            return {
              error,
              code: "SAMPLE_PATH_EXISTS",
              nextAction: "graphforge.openSampleProject",
            };
          }
          rmrf(target);
        }

        let dataset: ReturnType<typeof loadQuickstartDataset>;
        try {
          dataset = loadQuickstartDataset(context.extensionPath);
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          presentError(`GraphForge: ${error}`);
          return { error, code: "SAMPLE_DATASET_MISSING", nextAction: "graphforge.checkEnvironment" };
        }

        try {
          fs.mkdirSync(target, { recursive: true });
          const project = await withEngineProgress("Seeding US air-routes sample…", async () => {
            await session.initializeProject(target);
            const { seedMutationPath } = materializeQuickstartProjectFiles(target, dataset);
            const seedMutation = readProjectQuery(target, seedMutationPath);
            await session.execute(seedMutation.cypher, seedMutation.params);
            // Seed CREATE must not complete the Get Started query step (#63).
            session.clearLastResult();
            writeQuickstartMarker(target);
            return session.project!;
          });
          refreshTrees();
          if (interactive) {
            void vscode.window.showInformationMessage(
              `Opened GraphForge air-routes sample: ${target}`,
            );
          }
          return { path: target, project, seeded: true };
        } catch (err) {
          return reportEngineError("seed sample project failed", err);
        }
      },
    ),
  );
}
