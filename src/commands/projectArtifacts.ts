import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  filterQueryResultMany,
  readProjectQuery,
  readProjectResult,
  readProjectVisualization,
  relativeProjectPath,
  resolveArtifactName,
  resolveProjectArtifactPath,
  resolveProjectMutationPath,
  scanProjectArtifacts,
  writeProjectQuery,
  writeProjectQueryTemplate,
  writeProjectVisualization,
  type ProjectVisualizationSpec,
} from "../session/projectArtifacts";
import {
  createResultGraphSpec,
  isVisualizationSpec,
  type ChartMark,
} from "../session/visualizationRegistry";
import type { GraphForgeSession } from "../session/graphForgeSession";
import type { ResultTableViewProvider } from "../views/resultTableView";
import { presentError } from "./shared";
import { XygVisualizationPanel } from "../webview/xygPanel";
import { loadXyg, validateVisualization } from "../webview/xygRuntime";

interface ArtifactPathArgs {
  path?: string | vscode.Uri;
  resultName?: string;
  waitForReady?: boolean;
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

interface CreateVisualizationArgs {
  name?: string;
  result?: string;
  kind?: "result-graph" | "chart" | "geospatial" | "temporal";
  filter?: { column: string; operator: "equals" | "contains"; value: string };
  mark?: ChartMark;
  x?: string;
  y?: string;
  color?: string;
  longitude?: string;
  latitude?: string;
  targetLongitude?: string;
  targetLatitude?: string;
  timestamp?: string;
  timezone?: string;
  base?: string;
  intent?: ProjectVisualizationSpec["intent"];

  open?: boolean;
}

function activeProjectRoot(session: GraphForgeSession): string {
  const root = session.project?.rootPath;
  if (!root) throw new Error("Open a GraphForge project first.");
  return root;
}

function errorOutcome(error: unknown): {
  error: string;
  code: string;
  nextAction?: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const invalidVisualization = /invalid GraphForge visualization spec/i.test(
    message,
  );
  presentError(`GraphForge: ${message}`);
  return {
    error: message,
    code: invalidVisualization
      ? "INVALID_VISUALIZATION_SPEC"
      : "PROJECT_ARTIFACT_ERROR",
    nextAction: /open a GraphForge project/i.test(message)
      ? "Call graphforge.openProject(path) or graphforge.openSampleProject({ path })."
      : invalidVisualization
        ? "Create an xyg.intent/v1 artifact with explicit field bindings; rerun its query to preserve Core Arrow."
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
      "graphforge.createProjectVisualization",
      async (args?: CreateVisualizationArgs) => {
        try {
          if (!args?.result || !args.kind) {
            throw new Error("Visualization creation requires result and kind.");
          }
          if (
            !["result-graph", "chart", "geospatial", "temporal"].includes(
              args.kind,
            )
          ) {
            throw new Error(
              `Visualization kind ${String(args.kind)} is not supported.`,
            );
          }
          const name = resolveArtifactName(args.name, "vis");
          if (
            args.filter &&
            (typeof args.filter.column !== "string" ||
              args.filter.column.trim().length === 0 ||
              (args.filter.operator !== "equals" &&
                args.filter.operator !== "contains") ||
              typeof args.filter.value !== "string" ||
              args.filter.value.trim().length === 0)
          ) {
            throw new Error(
              "Visualization filter requires column, operator, and value.",
            );
          }
          const filters = args.filter ? [args.filter] : [];
          let spec: ProjectVisualizationSpec;
          if (args.kind === "result-graph")
            spec = createResultGraphSpec({
              name,
              result: args.result,
              filters,
              base: args.base,
              intent: args.intent,
            });
          else if (args.kind === "chart")
            spec = {
              format: "xyg.intent/v1",
              name,
              result: args.result,
              kind: args.kind,
              filters,
              chart: {
                mark: args.mark!,
                x: args.x!,
                y: args.y,
                color: args.color,
              },
            };
          else if (args.kind === "geospatial")
            spec = {
              format: "xyg.intent/v1",
              name,
              result: args.result,
              kind: args.kind,
              filters,
              geospatial: {
                longitude: args.longitude!,
                latitude: args.latitude!,
                targetLongitude: args.targetLongitude,
                targetLatitude: args.targetLatitude,
                crs: 4326,
                projection: 3857,
                longitudeCenter: -98,
                latitudeCenter: 38,
                zoom: 3,
              },
            };
          else
            spec = {
              format: "xyg.intent/v1",
              name,
              result: args.result,
              kind: args.kind,
              filters,
              temporal: {
                timestamp: args.timestamp!,
                value: args.y!,
                series: args.color,
                timezone: "UTC",
                mark:
                  args.mark === "scatter"
                    ? "scatter"
                    : args.mark === "bar"
                      ? "bar"
                      : "line",
              },
            };
          if (args.timezone && args.timezone !== "UTC")
            throw new Error("XYG temporal views require UTC.");
          if (!isVisualizationSpec(spec))
            throw new Error(
              "XYG intent requires explicit valid field bindings.",
            );
          return vscode.commands.executeCommand(
            "graphforge.saveProjectVisualization",
            {
              name,
              spec,
              open: args.open,
            },
          );
        } catch (error) {
          return errorOutcome(error);
        }
      },
    ),
    vscode.commands.registerCommand(
      "graphforge.openProjectArtifact",
      async (args?: ArtifactPathInput) => {
        try {
          const artifactPath = pathFromInput(args);
          if (!artifactPath) throw new Error("Artifact path is required.");
          const absolute = resolveProjectArtifactPath(
            activeProjectRoot(session),
            artifactPath,
          );
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
            sourceQuery: relativeProjectPath(
              activeProjectRoot(session),
              resolveProjectArtifactPath(activeProjectRoot(session), queryPath),
            ),
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
          const artifactPath = writeProjectQuery(
            projectRoot,
            args.name,
            args.cypher,
          );
          session.notifyChanged();
          if (args.run) {
            return vscode.commands.executeCommand(
              "graphforge.runProjectQuery",
              {
                path: artifactPath,
                resultName: args.resultName,
              },
            );
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
            return vscode.commands.executeCommand(
              "graphforge.runProjectQuery",
              {
                path: artifactPath,
                resultName: args.resultName,
              },
            );
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
          const absolutePath = resolveProjectArtifactPath(
            projectRoot,
            resultPath,
          );
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
          if (!visualizationPath)
            throw new Error("Visualization path is required.");
          const projectRoot = activeProjectRoot(session);
          const absolutePath = resolveProjectArtifactPath(
            projectRoot,
            visualizationPath,
          );
          const relativePath = relativeProjectPath(projectRoot, absolutePath);
          const spec = readProjectVisualization(projectRoot, visualizationPath);
          const source = readProjectResult(projectRoot, spec.result);
          const result = filterQueryResultMany(source, spec.filters);
          const base = spec.base
            ? readProjectResult(projectRoot, spec.base)
            : undefined;
          const shown = XygVisualizationPanel.show(
            context.extensionUri,
            spec,
            result,
            projectRoot,
            relativePath,
            base,
          );
          session.restoreResult(result, spec.name);
          await results.show(
            result,
            `${spec.name} · ${result.rowCount} row(s)`,
            persistedResultPaths(projectRoot, spec.result),
          );
          const shouldWait =
            typeof args === "object" &&
            !(args instanceof vscode.Uri) &&
            args.waitForReady;
          const lifecycle = shouldWait ? await shown.panel.ready : undefined;
          return {
            path: relativePath,
            absolutePath,
            kind: spec.kind,
            spec,
            panel: shown.status,
            instanceId: shown.panel.instanceId,
            ...(lifecycle ? { lifecycle } : {}),
          };
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
          if (!isVisualizationSpec(args.spec)) throw new Error("Visualization settings are incomplete.");
          const projectRoot = activeProjectRoot(session);
          const source = readProjectResult(projectRoot, args.spec.result);
          for (const filter of args.spec.filters) {
            if (!source.columns.includes(filter.column))
              throw new Error(`XYG_FIELD_MISSING: ${filter.column}`);
          }
          // Graph admission rejects filters through graphInput before they can discard Arrow.
          const result = args.spec.kind === "result-graph"
            ? source : filterQueryResultMany(source, args.spec.filters);
          const base = args.spec.base ? readProjectResult(projectRoot, args.spec.base) : undefined;
          const xy = await loadXyg(context.extensionUri.fsPath);
          validateVisualization(xy, args.spec, result, base);
          const artifactPath = writeProjectVisualization(
            projectRoot,
            args.name,
            args.spec,
          );
          const spec = readProjectVisualization(projectRoot, artifactPath);
          session.notifyChanged();
          if (args.open !== false) {
            const opened = await vscode.commands.executeCommand<
              Record<string, unknown>
            >("graphforge.openProjectVisualization", { path: artifactPath });
            if (opened && typeof opened.error === "string") {
              return { path: artifactPath, spec, ...opened };
            }
            return { path: artifactPath, spec, ...(opened ?? {}) };
          }
          return { path: artifactPath, spec };
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
            const choices = scanProjectArtifacts(projectRoot).mutations.filter(
              (entry) =>
                [".cypher", ".cql", ".json"].includes(
                  path.extname(entry.path).toLowerCase(),
                ),
            );
            const selected = await vscode.window.showQuickPick(
              choices.map((entry) => ({
                label: entry.name,
                detail: entry.path,
                path: entry.path,
              })),
              { title: "GraphForge: Apply Project Mutation…" },
            );
            if (!selected) return { cancelled: true };
            mutationPath = selected.path;
          }

          if (!mutationPath) throw new Error("Mutation path is required.");
          const absolutePath = resolveProjectMutationPath(
            projectRoot,
            mutationPath,
          );
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
          const result = await session.executeMutation(
            mutation.cypher,
            mutation.params,
          );
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
