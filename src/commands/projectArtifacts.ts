import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  filterQueryResult,
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
  createDefaultChartSpec,
  createDefaultGeospatialSpec,
  createDefaultTemporalSpec,
  createResultGraphSpec,
  type ChartMarkV2,
  type ResultGraphVisualizationSpecV2,
  type TemporalVisualizationSpecV2,
} from "../session/visualizationRegistry";
import type { GraphForgeSession } from "../session/graphForgeSession";
import type { ResultTableViewProvider } from "../views/resultTableView";
import { presentError } from "./shared";
import { ArtifactVisualizationPanel } from "../webview/artifactVisualizationPanel";
import {
  ResultGraphPanel,
  type ResultGraphLifecycleMessage,
} from "../webview/resultGraphPanel";
import type { ResultGraphViewOptions } from "../webview/resultGraphModel";

function requireResultFields(
  result: { columns: string[] },
  fields: Array<string | null | undefined>,
  context: string,
): void {
  const missing = [...new Set(fields.filter((field): field is string => Boolean(field)))]
    .filter((field) => !result.columns.includes(field));
  if (missing.length > 0) {
    throw new Error(`${context} references missing result field(s): ${missing.join(", ")}.`);
  }
}

function validateVisualizationResultBindings(
  spec: ProjectVisualizationSpec,
  result: { columns: string[] },
): void {
  if (spec.format !== "graphforge.visualization/v2") return;
  requireResultFields(result, spec.filters.map((filter) => filter.column), "Visualization filters");
  if (spec.kind === "chart") {
    requireResultFields(result, [
      spec.chart.bindings.x,
      spec.chart.bindings.y,
      spec.chart.bindings.color,
      spec.chart.bindings.size,
      spec.chart.bindings.shape,
      spec.chart.bindings.series,
      ...spec.chart.sort.map((item) => item.field),
    ], "Chart bindings");
  } else if (spec.kind === "geospatial") {
    requireResultFields(
      result,
      spec.geospatial.source.type === "coordinates"
        ? [spec.geospatial.source.longitudeField, spec.geospatial.source.latitudeField]
        : [spec.geospatial.source.geometryField],
      "Geospatial bindings",
    );
  } else if (spec.kind === "temporal") {
    requireResultFields(result, [
      spec.temporal.timestampField,
      spec.temporal.valueField,
      spec.temporal.seriesField,
    ], "Temporal bindings");
  }
}

function v2ResultGraphOptions(
  spec: ResultGraphVisualizationSpecV2,
): ResultGraphViewOptions {
  const layout = spec.graph.layout;
  const timebar = spec.graph.timebar;
  const nodeField = timebar.enabled ? timebar.nodeTimestampField : null;
  const edgeField = timebar.enabled ? timebar.edgeTimestampField : null;
  return {
    renderer: spec.renderer.id,
    backend: spec.renderer.backend,
    source: "artifact-v2",
    layout:
      layout.type === "cose"
        ? {
            maxIterations: layout.maxIterations,
            nodeRepulsion: layout.nodeRepulsion,
            idealEdgeLength: layout.idealEdgeLength,
            gravity: layout.gravity,
          }
        : layout.execution === "main"
          ? {
              iterations: layout.iterations,
              gravity: layout.gravity,
              slowDown: layout.slowDown,
              barnesHutOptimize: layout.barnesHutOptimize,
            }
          : { ...layout },
    visualDensity: {
      nodeSize: spec.graph.style.nodeSize,
      edgeWidth: spec.graph.style.edgeWidth,
      showNodeLabels: spec.graph.style.nodeLabelFields.length > 0,
      showEdgeLabels: spec.graph.style.showEdgeLabels,
      arrowheads: spec.graph.style.arrowheads,
    },
    labels: {
      nodeFields: [...spec.graph.style.nodeLabelFields],
      nodeFallback: spec.graph.style.nodeLabelFallback,
      edgeField: spec.graph.style.edgeLabelField,
    },
    timebar: timebar.enabled
      ? {
          enabled: true as const,
          nodeField,
          edgeField,
          format: "iso-8601" as const,
          elementTypes: [
            ...(nodeField ? (["node"] as const) : []),
            ...(edgeField ? (["edge"] as const) : []),
          ],
          values: [Date.parse(timebar.range.start), Date.parse(timebar.range.end)] as [number, number],
          position: "bottom" as const,
          width: 450,
          height: 60,
          loop: false,
        }
      : { enabled: false as const },
  };
}

interface ArtifactPathArgs {
  path?: string | vscode.Uri;
  resultName?: string;
  waitForReady?: boolean;
  timeoutMs?: number;
}

type ArtifactPathInput = string | vscode.Uri | ArtifactPathArgs;

function waitForResultGraphLifecycle(
  renderer: "g6" | "cytoscape" | "sigma",
  timeoutMs: number,
): Promise<ResultGraphLifecycleMessage> {
  return new Promise((resolve) => {
    let disposable: vscode.Disposable | undefined;
    let timer: NodeJS.Timeout | undefined;
    const finish = (message: ResultGraphLifecycleMessage): void => {
      disposable?.dispose();
      if (timer) clearTimeout(timer);
      resolve(message);
    };
    disposable = ResultGraphPanel.onDidLifecycle((message) => {
      if (
        message.renderer === renderer &&
        (message.type === "graphforge/renderReady" ||
          message.type === "graphforge/renderFailed")
      ) {
        finish(message);
      }
    });
    timer = setTimeout(
      () =>
        finish({
          type: "graphforge/renderFailed",
          renderer,
          phase: "render",
          code: "GF_RENDER_LIFECYCLE_TIMEOUT",
          message: `Renderer did not reach a terminal lifecycle state within ${timeoutMs} ms.`,
        }),
      timeoutMs,
    );
  });
}

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
  mark?: ChartMarkV2 | TemporalVisualizationSpecV2["temporal"]["mark"];
  x?: string;
  y?: string;
  color?: string;
  longitude?: string;
  latitude?: string;
  timestamp?: string;
  timezone?: string;
  granularity?: TemporalVisualizationSpecV2["temporal"]["granularity"];
  renderer?: "g6" | "cytoscape" | "sigma" | "g2" | "plotly" | "l7";
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
  const invalidVisualization = /invalid GraphForge visualization spec/i.test(message);
  presentError(`GraphForge: ${message}`);
  return {
    error: message,
    code: invalidVisualization
      ? "INVALID_VISUALIZATION_SPEC"
      : "PROJECT_ARTIFACT_ERROR",
    nextAction: /open a GraphForge project/i.test(message)
      ? "Call graphforge.openProject(path) or graphforge.openSampleProject({ path })."
      : invalidVisualization
        ? "Open the .gfviz.json artifact and supply every required v2 field, or use a supported v1 artifact unchanged."
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
          if (!["result-graph", "chart", "geospatial", "temporal"].includes(args.kind)) {
            throw new Error(`Visualization kind ${String(args.kind)} is not supported.`);
          }
          const name = resolveArtifactName(args.name, "vis");
          if (
            args.filter &&
            (
              typeof args.filter.column !== "string" ||
              args.filter.column.trim().length === 0 ||
              (args.filter.operator !== "equals" && args.filter.operator !== "contains") ||
              typeof args.filter.value !== "string"
            )
          ) {
            throw new Error("Visualization filter requires column, operator, and value.");
          }
          const filters = args.filter ? [args.filter] : [];
          const config = vscode.workspace.getConfiguration("graphforge");
          let spec: ProjectVisualizationSpec;
          if (args.kind === "result-graph") {
            if (
              args.renderer !== undefined &&
              args.renderer !== "g6" &&
              args.renderer !== "cytoscape" &&
              args.renderer !== "sigma"
            ) {
              throw new Error(
                `Renderer ${args.renderer} is not supported for result-graph. Use g6, cytoscape, or sigma.`,
              );
            }
            spec = createResultGraphSpec({
              name,
              result: args.result,
              filters,
              renderer:
                args.renderer === "g6" || args.renderer === "cytoscape" || args.renderer === "sigma"
                  ? args.renderer
                  : config.get("resultGraph.renderer", "g6"),
            });
          } else if (args.kind === "chart") {
            if (
              args.renderer !== undefined &&
              args.renderer !== "g2" &&
              args.renderer !== "plotly"
            ) {
              throw new Error(
                `Renderer ${args.renderer} is not supported for chart. Use g2 or plotly.`,
              );
            }
            const chartMarks: readonly ChartMarkV2[] = ["bar", "scatter", "line", "histogram"];
            if (
              !args.mark ||
              !chartMarks.includes(args.mark as ChartMarkV2) ||
              !args.x ||
              (args.mark !== "histogram" && !args.y)
            ) {
              throw new Error("Chart creation requires mark, x, and y (except histogram).");
            }
            spec = createDefaultChartSpec({
              name,
              result: args.result,
              filters,
              renderer: args.renderer === "plotly" ? "plotly" : config.get("chart.renderer", "g2"),
              mark: args.mark as ChartMarkV2,
              x: args.x,
              y: args.mark === "histogram" ? null : args.y ?? null,
              color: args.color ?? null,
              title: name || null,
            });
          } else if (args.kind === "geospatial") {
            if (args.renderer !== undefined && args.renderer !== "l7") {
              throw new Error(
                `Renderer ${args.renderer} is not supported for geospatial. Use l7.`,
              );
            }
            if (!args.longitude || !args.latitude) {
              throw new Error("Geospatial creation requires explicit longitude and latitude fields.");
            }
            spec = createDefaultGeospatialSpec({
              name,
              result: args.result,
              filters,
              source: {
                type: "coordinates",
                longitudeField: args.longitude,
                latitudeField: args.latitude,
              },
              sourceCrs: "EPSG:4326",
              projection: "EPSG:3857",
              layers: [{
                id: "points",
                type: "point",
                colorField: null,
                sizeField: null,
                shapeField: null,
                color: "#4c6ef5",
                opacity: 0.8,
                size: 6,
              }],
              viewport: { longitude: 0, latitude: 20, zoom: 1.5, bearing: 0, pitch: 0, bounds: null },
            });
          } else {
            if (args.renderer !== undefined && args.renderer !== "g2") {
              throw new Error(
                `Renderer ${args.renderer} is not supported for temporal. Use g2.`,
              );
            }
            if (!args.timestamp || !args.y) {
              throw new Error("Temporal creation requires explicit timestamp and value fields.");
            }
            if (
              args.mark !== undefined &&
              args.mark !== "line" &&
              args.mark !== "bar" &&
              args.mark !== "point"
            ) {
              throw new Error(
                `Mark ${args.mark} is not supported for temporal. Use line, bar, or point.`,
              );
            }
            spec = createDefaultTemporalSpec({
              name,
              result: args.result,
              filters,
              mark: args.mark ?? "line",
              timestampField: args.timestamp,
              timezone: args.timezone || "UTC",
              granularity: args.granularity || "day",
              valueField: args.y,
              seriesField: args.color ?? null,
              title: name || null,
            });
          }
          validateVisualizationResultBindings(
            spec,
            readProjectResult(activeProjectRoot(session), args.result),
          );
          return vscode.commands.executeCommand("graphforge.saveProjectVisualization", {
            name,
            spec,
            open: args.open,
          });
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
          const result = spec.format === "graphforge.visualization/v2"
            ? filterQueryResultMany(readProjectResult(projectRoot, spec.result), spec.filters)
            : filterQueryResult(readProjectResult(projectRoot, spec.result), spec.filter);
          validateVisualizationResultBindings(spec, result);
          session.restoreResult(result, spec.name);
          await results.show(
            result,
            `${spec.name} · ${result.rowCount} row(s)`,
            persistedResultPaths(projectRoot, spec.result),
          );

          if (spec.kind === "result-graph") {
            const renderer =
              spec.format === "graphforge.visualization/v2"
                ? spec.renderer.id
                : spec.graph.renderer;
            const options = spec.format === "graphforge.visualization/v2"
              ? v2ResultGraphOptions(spec)
              : { renderer: spec.graph.renderer, layout: spec.graph.layout };
            const graphPayload = spec.format === "graphforge.visualization/v2"
              ? {
                  ...(await session.toGraphPayload(result, spec.name)),
                  styleMode: spec.graph.style.preset === "graphforge-class/v1"
                    ? "class-only" as const
                    : "epistemic" as const,
                }
              : undefined;
            const waitForReady =
              typeof args === "object" &&
              !(args instanceof vscode.Uri) &&
              args.waitForReady === true;
            const timeoutMs =
              typeof args === "object" &&
              !(args instanceof vscode.Uri) &&
              Number.isInteger(args.timeoutMs) &&
              (args.timeoutMs ?? 0) >= 1_000 &&
              (args.timeoutMs ?? 0) <= 60_000
                ? args.timeoutMs!
                : 30_000;
            const lifecycle = waitForReady
              ? waitForResultGraphLifecycle(renderer, timeoutMs)
              : undefined;
            const outcome = await vscode.commands.executeCommand(
              "graphforge.showResultGraph",
              {
                title: spec.name,
                payload: graphPayload,
                ...options,
              },
            );
            if (spec.format === "graphforge.visualization/v2") {
              ResultGraphPanel.current?.attachArtifact(
                projectRoot,
                relativePath,
                spec,
                () => session.notifyChanged(),
              );
            }
            const terminalLifecycle = lifecycle ? await lifecycle : undefined;
            return {
              path: relativePath,
              absolutePath,
              kind: spec.kind,
              spec,
              ...(terminalLifecycle ? { lifecycle: terminalLifecycle } : {}),
              ...(outcome && typeof outcome === "object"
                ? outcome
                : { outcome }),
            };
          }

          if (spec.kind === "plotly") {
            const outcome = await vscode.commands.executeCommand("graphforge.figureFromResult", {
              table: { columns: result.columns, rows: result.rows },
              ...spec.plotly,
            });
            return { path: relativePath, absolutePath, kind: spec.kind, spec, outcome };
          }

          if (spec.kind === "chart" && spec.renderer.id === "plotly") {
            const outcome = await vscode.commands.executeCommand("graphforge.figureFromResult", {
              table: { columns: result.columns, rows: result.rows },
              chartType: spec.chart.mark,
              x: spec.chart.bindings.x,
              y: spec.chart.bindings.y ?? undefined,
              color: spec.chart.bindings.color ?? spec.chart.bindings.series ?? undefined,
              title: spec.chart.title ?? undefined,
            });
            return { path: relativePath, absolutePath, kind: spec.kind, spec, outcome };
          }

          const shown = ArtifactVisualizationPanel.show(
            context.extensionUri,
            projectRoot,
            relativePath,
            spec,
            result,
            () => session.notifyChanged(),
            (rowIndex) => results.selectRow(rowIndex),
          );
          return {
            path: relativePath,
            absolutePath,
            kind: spec.kind,
            spec,
            panel: shown.status,
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
          const projectRoot = activeProjectRoot(session);
          const artifactPath = writeProjectVisualization(
            projectRoot,
            args.name,
            args.spec,
          );
          const spec = readProjectVisualization(projectRoot, artifactPath);
          session.notifyChanged();
          if (args.open !== false) {
            const opened = await vscode.commands.executeCommand<Record<string, unknown>>(
              "graphforge.openProjectVisualization",
              { path: artifactPath },
            );
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
