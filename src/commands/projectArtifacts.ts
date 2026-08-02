import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  filterQueryResult,
  readProjectQuery,
  readProjectResult,
  readProjectVisualization,
  relativeProjectPath,
  resolveProjectArtifactPath,
  resolveProjectMutationPath,
  scanProjectArtifacts,
  VISUALIZATION_SPEC_FORMAT,
  writeProjectQuery,
  writeProjectQueryTemplate,
  writeProjectVisualization,
  type ProjectVisualizationSpec,
} from "../session/projectArtifacts";
import type { GraphForgeSession } from "../session/graphForgeSession";
import type { ResultTableViewProvider } from "../views/resultTableView";
import { presentError } from "./shared";

interface ArtifactPathArgs {
  path?: string | vscode.Uri;
  resultName?: string;
}

type ArtifactPathInput = string | vscode.Uri | ArtifactPathArgs;

interface ApplyMutationArgs extends ArtifactPathArgs {
  confirm?: boolean;
}

interface SaveQueryArgs {
  name?: string;
  cypher?: string;
  run?: boolean;
  resultName?: string;
}

interface SaveVisualizationArgs {
  name?: string;
  spec?: ProjectVisualizationSpec;
  open?: boolean;
}

function activeProjectRoot(session: GraphForgeSession): string {
  const root = session.project?.rootPath;
  if (!root) throw new Error("Open a GraphForge project first.");
  return root;
}

function errorOutcome(
  error: unknown,
): { error: string; code: string; nextAction?: string } {
  const message = error instanceof Error ? error.message : String(error);
  presentError(`GraphForge: ${message}`);
  return {
    error: message,
    code: "PROJECT_ARTIFACT_ERROR",
    nextAction: /open a GraphForge project/i.test(message)
      ? "Call graphforge.openProject(path) or graphforge.openSampleProject({ path })."
      : undefined,
  };
}

function pathFromInput(args?: ArtifactPathInput): string | undefined {
  if (typeof args === "string") return args.trim() || undefined;
  if (args && typeof args === "object" && "fsPath" in args) {
    return typeof args.fsPath === "string" ? args.fsPath : undefined;
  }
  const value = args?.path;
  if (typeof value === "string") return value.trim() || undefined;
  return value?.fsPath;
}

function resultNameFromInput(args?: ArtifactPathInput): string | undefined {
  if (!args || typeof args === "string" || "fsPath" in args) return undefined;
  return args.resultName;
}

function persistedResultPaths(
  projectRoot: string,
  relativePath: string,
): { jsonPath: string; markdownPath: string } {
  const jsonPath = resolveProjectArtifactPath(projectRoot, relativePath);
  const markdownPath = jsonPath.replace(/\.json$/i, ".md");
  return {
    jsonPath,
    markdownPath: fs.existsSync(markdownPath) ? markdownPath : jsonPath,
  };
}

export function registerProjectArtifacts(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
  results: ResultTableViewProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "graphforge.openProjectArtifact",
      async (args?: ArtifactPathInput) => {
        try {
          const artifactPath = pathFromInput(args);
          if (!artifactPath) throw new Error("Artifact path is required.");
          const absolute = resolveProjectArtifactPath(activeProjectRoot(session), artifactPath);
          const document = await vscode.workspace.openTextDocument(absolute);
          await vscode.window.showTextDocument(document, { preview: true });
          return { path: artifactPath, absolutePath: absolute };
        } catch (error) {
          return errorOutcome(error);
        }
      },
    ),

    vscode.commands.registerCommand(
      "graphforge.runProjectQuery",
      async (args?: ArtifactPathInput) => {
        try {
          const queryPath = pathFromInput(args);
          if (!queryPath) throw new Error("Query path is required.");
          const query = readProjectQuery(activeProjectRoot(session), queryPath);
          return vscode.commands.executeCommand("graphforge.runQuery", {
            ...query,
            resultName: resultNameFromInput(args),
          });
        } catch (error) {
          return errorOutcome(error);
        }
      },
    ),

    vscode.commands.registerCommand(
      "graphforge.saveProjectQuery",
      async (args?: SaveQueryArgs) => {
        try {
          if (!args?.cypher) {
            throw new Error("Cypher text is required.");
          }
          const projectRoot = activeProjectRoot(session);
          const artifactPath = writeProjectQuery(projectRoot, args.name, args.cypher);
          session.notifyChanged();
          if (args.run) {
            return vscode.commands.executeCommand("graphforge.runProjectQuery", {
              path: artifactPath,
              resultName: args.resultName,
            });
          }
          const document = await vscode.workspace.openTextDocument(
            resolveProjectArtifactPath(projectRoot, artifactPath),
          );
          await vscode.window.showTextDocument(document, { preview: false });
          return { path: artifactPath };
        } catch (error) {
          return errorOutcome(error);
        }
      },
    ),

    vscode.commands.registerCommand(
      "graphforge.saveProjectQueryTemplate",
      async (args?: SaveQueryArgs) => {
        try {
          if (!args?.cypher) {
            throw new Error("Cypher text is required.");
          }
          const projectRoot = activeProjectRoot(session);
          const artifactPath = writeProjectQueryTemplate(
            projectRoot,
            args.name,
            args.cypher,
          );
          session.notifyChanged();
          if (args.run) {
            return vscode.commands.executeCommand("graphforge.runProjectQuery", {
              path: artifactPath,
              resultName: args.resultName,
            });
          }
          const document = await vscode.workspace.openTextDocument(
            resolveProjectArtifactPath(projectRoot, artifactPath),
          );
          await vscode.window.showTextDocument(document, { preview: false });
          return { path: artifactPath };
        } catch (error) {
          return errorOutcome(error);
        }
      },
    ),

    vscode.commands.registerCommand(
      "graphforge.openProjectResult",
      async (args?: ArtifactPathInput) => {
        try {
          const resultPath = pathFromInput(args);
          if (!resultPath) throw new Error("Result path is required.");
          const projectRoot = activeProjectRoot(session);
          const absolutePath = resolveProjectArtifactPath(projectRoot, resultPath);
          const relativePath = relativeProjectPath(projectRoot, absolutePath);
          const result = readProjectResult(projectRoot, resultPath);
          session.restoreResult(result, path.basename(resultPath));
          await results.show(
            result,
            `Saved result · ${path.basename(resultPath)}`,
            persistedResultPaths(projectRoot, resultPath),
          );
          return {
            path: relativePath,
            absolutePath,
            rowCount: result.rowCount,
            columns: result.columns,
          };
        } catch (error) {
          return errorOutcome(error);
        }
      },
    ),

    vscode.commands.registerCommand(
      "graphforge.openProjectVisualization",
      async (args?: ArtifactPathInput) => {
        try {
          const visualizationPath = pathFromInput(args);
          if (!visualizationPath) throw new Error("Visualization path is required.");
          const projectRoot = activeProjectRoot(session);
          const absolutePath = resolveProjectArtifactPath(projectRoot, visualizationPath);
          const relativePath = relativeProjectPath(projectRoot, absolutePath);
          const spec = readProjectVisualization(projectRoot, visualizationPath);
          const result = filterQueryResult(
            readProjectResult(projectRoot, spec.result),
            spec.filter,
          );
          session.restoreResult(result, spec.name);
          await results.show(
            result,
            `${spec.name} · ${result.rowCount} row(s)`,
            persistedResultPaths(projectRoot, spec.result),
          );

          if (spec.kind === "result-graph") {
            const outcome = await vscode.commands.executeCommand(
              "graphforge.showResultGraph",
              {
              title: spec.name,
              renderer: spec.graph.renderer,
              layout: spec.graph.layout,
              },
            );
            return {
              path: relativePath,
              absolutePath,
              kind: spec.kind,
              ...(outcome && typeof outcome === "object"
                ? outcome
                : { outcome }),
            };
          }

          const outcome = await vscode.commands.executeCommand("graphforge.figureFromResult", {
            table: { columns: result.columns, rows: result.rows },
            ...spec.plotly,
          });
          return { path: relativePath, absolutePath, kind: spec.kind, outcome };
        } catch (error) {
          return errorOutcome(error);
        }
      },
    ),

    vscode.commands.registerCommand(
      "graphforge.saveProjectVisualization",
      async (args?: SaveVisualizationArgs) => {
        try {
          if (!args?.spec) {
            throw new Error("Visualization settings are required.");
          }
          const projectRoot = activeProjectRoot(session);
          const spec = {
            ...args.spec,
            format: VISUALIZATION_SPEC_FORMAT,
          } as ProjectVisualizationSpec;
          const artifactPath = writeProjectVisualization(
            projectRoot,
            args.name,
            spec,
          );
          session.notifyChanged();
          if (args.open !== false) {
            return vscode.commands.executeCommand(
              "graphforge.openProjectVisualization",
              { path: artifactPath },
            );
          }
          return { path: artifactPath };
        } catch (error) {
          return errorOutcome(error);
        }
      },
    ),

    vscode.commands.registerCommand(
      "graphforge.applyProjectMutation",
      async (args?: string | vscode.Uri | ApplyMutationArgs) => {
        try {
          const projectRoot = activeProjectRoot(session);
          const interactive = args === undefined;
          let mutationPath = pathFromInput(args);

          if (interactive) {
            const choices = scanProjectArtifacts(projectRoot).mutations.filter((entry) =>
              [".cypher", ".cql", ".json"].includes(path.extname(entry.path).toLowerCase()),
            );
            const selected = await vscode.window.showQuickPick(
              choices.map((entry) => ({ label: entry.name, detail: entry.path, path: entry.path })),
              { title: "GraphForge: Apply Project Mutation…" },
            );
            if (!selected) return { cancelled: true };
            mutationPath = selected.path;
          }

          if (!mutationPath) throw new Error("Mutation path is required.");
          const absolutePath = resolveProjectMutationPath(projectRoot, mutationPath);
          const relativePath = relativeProjectPath(projectRoot, absolutePath);

          if (interactive) {
            const choice = await vscode.window.showWarningMessage(
              `Apply ${relativePath} to the open GraphForge project?`,
              { modal: true },
              "Apply mutation",
            );
            if (choice !== "Apply mutation") return { cancelled: true };
          } else if (
            typeof args !== "object" ||
            "fsPath" in args ||
            args.confirm !== true
          ) {
            return {
              error: "Applying a mutation requires explicit { confirm: true }.",
              code: "CONFIRMATION_REQUIRED",
              nextAction: `Call graphforge.applyProjectMutation({ path: ${JSON.stringify(relativePath)}, confirm: true }).`,
            };
          }

          const mutation = readProjectQuery(projectRoot, relativePath);
          const result = await session.executeMutation(mutation.cypher, mutation.params);
          session.notifyChanged();
          if (interactive) {
            void vscode.window.showInformationMessage(
              `GraphForge: applied ${relativePath} (${result.rowCount} row(s)).`,
            );
          }
          return {
            path: relativePath,
            absolutePath,
            columns: result.columns,
            rowCount: result.rowCount,
          };
        } catch (error) {
          return errorOutcome(error);
        }
      },
    ),
  );
}
