import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { FigureChartType } from "./figureFromResult";
import type { QueryResult, TableRow } from "./types";
import type { ResultGraphRenderer } from "../webview/resultGraphModel";
import {
  isVisualizationSpecV2,
  VISUALIZATION_SPEC_FORMAT_V2,
  type ProjectVisualizationSpecV2,
} from "./visualizationRegistry";

export const PROJECT_QUERIES_DIR = "queries";
export const PROJECT_QUERY_TEMPLATES_DIR = "queries/templates";
export const PROJECT_RESULTS_DIR = "results";
export const PROJECT_VISUALIZATIONS_DIR = "visualizations";
export const PROJECT_MUTATIONS_DIR = "mutations";

export const VISUALIZATION_SPEC_FORMAT_V1 = "graphforge.visualization/v1" as const;
/** Compatibility name retained for callers that create v1 artifacts. */
export const VISUALIZATION_SPEC_FORMAT = VISUALIZATION_SPEC_FORMAT_V1;
export { VISUALIZATION_SPEC_FORMAT_V2 };
export type { ProjectVisualizationSpecV2 } from "./visualizationRegistry";

export interface ProjectArtifactEntry {
  name: string;
  path: string;
}

export interface ProjectResultEntry extends ProjectArtifactEntry {
  columns: string[];
  rowCount: number;
}

export interface ProjectVisualizationEntry extends ProjectArtifactEntry {
  kind: ProjectVisualizationSpec["kind"];
  result: string;
}

export interface ProjectArtifactIndex {
  queries: ProjectArtifactEntry[];
  queryTemplates: ProjectArtifactEntry[];
  results: ProjectResultEntry[];
  visualizations: ProjectVisualizationEntry[];
  mutations: ProjectArtifactEntry[];
}

export interface ProjectQuery {
  cypher: string;
  params?: Record<string, unknown>;
}

export interface ResultFilter {
  column: string;
  operator: "equals" | "contains";
  value: string;
}

export interface ResultGraphVisualizationSpec {
  format: typeof VISUALIZATION_SPEC_FORMAT_V1;
  name: string;
  kind: "result-graph";
  result: string;
  filter?: ResultFilter;
  graph: {
    renderer: ResultGraphRenderer;
    layout?: {
      nodeRepulsion?: number;
      idealEdgeLength?: number;
      gravity?: number;
      slowDown?: number;
    };
  };
}

export interface PlotlyVisualizationSpec {
  format: typeof VISUALIZATION_SPEC_FORMAT_V1;
  name: string;
  kind: "plotly";
  result: string;
  filter?: ResultFilter;
  plotly: {
    chartType: FigureChartType;
    x: string;
    y?: string;
    color?: string;
    title?: string;
  };
}

export type ProjectVisualizationSpecV1 =
  | ResultGraphVisualizationSpec
  | PlotlyVisualizationSpec;

export type ProjectVisualizationSpec =
  | ProjectVisualizationSpecV1
  | ProjectVisualizationSpecV2;

function isInsideProject(projectRoot: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(projectRoot), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Resolve a project-relative path and reject traversal/out-of-project paths. */
export function resolveProjectArtifactPath(projectRoot: string, artifactPath: string): string {
  const resolved = path.isAbsolute(artifactPath)
    ? path.resolve(artifactPath)
    : path.resolve(projectRoot, artifactPath);
  if (!isInsideProject(projectRoot, resolved)) {
    throw new Error(`Artifact path must stay inside the open project: ${artifactPath}`);
  }
  return resolved;
}

/** Resolve an executable mutation and require it to live under `mutations/`. */
export function resolveProjectMutationPath(projectRoot: string, mutationPath: string): string {
  const resolved = resolveProjectArtifactPath(projectRoot, mutationPath);
  const mutationRoot = path.join(projectRoot, PROJECT_MUTATIONS_DIR);
  if (!isInsideProject(mutationRoot, resolved)) {
    throw new Error(`Mutation path must stay inside ${PROJECT_MUTATIONS_DIR}/: ${mutationPath}`);
  }
  if (![".cypher", ".cql", ".json"].includes(path.extname(resolved).toLowerCase())) {
    throw new Error(`Mutation must be a .cypher, .cql, or .json query spec: ${mutationPath}`);
  }
  return resolved;
}

export function relativeProjectPath(projectRoot: string, artifactPath: string): string {
  return path.relative(projectRoot, artifactPath).split(path.sep).join("/");
}

function listFiles(root: string, extensions?: readonly string[]): string[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const child = path.join(root, entry.name);
      return entry.isDirectory() ? listFiles(child, extensions) : [child];
    })
    .filter((file) => !extensions || extensions.includes(path.extname(file).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
}

function artifactEntry(projectRoot: string, filePath: string): ProjectArtifactEntry {
  return {
    name: path.basename(filePath),
    path: relativeProjectPath(projectRoot, filePath),
  };
}

function parseQueryResult(value: unknown, source: string): QueryResult {
  if (!value || typeof value !== "object") {
    throw new Error(`Result is not an object: ${source}`);
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.columns) || !record.columns.every((item) => typeof item === "string")) {
    throw new Error(`Result columns must be strings: ${source}`);
  }
  if (!Array.isArray(record.rows) || !record.rows.every((item) => item && typeof item === "object")) {
    throw new Error(`Result rows must be objects: ${source}`);
  }
  return {
    columns: record.columns as string[],
    rows: record.rows as TableRow[],
    rowCount:
      typeof record.rowCount === "number" ? record.rowCount : record.rows.length,
  };
}

export function readProjectResult(projectRoot: string, resultPath: string): QueryResult {
  const absolute = resolveProjectArtifactPath(projectRoot, resultPath);
  return parseQueryResult(JSON.parse(fs.readFileSync(absolute, "utf8")), resultPath);
}

export function readProjectQuery(projectRoot: string, queryPath: string): ProjectQuery {
  const absolute = resolveProjectArtifactPath(projectRoot, queryPath);
  if (absolute.endsWith(".json")) {
    const parsed = JSON.parse(fs.readFileSync(absolute, "utf8")) as Record<string, unknown>;
    if (typeof parsed.cypher !== "string" || !parsed.cypher.trim()) {
      throw new Error(`Query spec requires a non-empty "cypher" string: ${queryPath}`);
    }
    const params =
      parsed.params && typeof parsed.params === "object" && !Array.isArray(parsed.params)
        ? (parsed.params as Record<string, unknown>)
        : undefined;
    return { cypher: parsed.cypher, params };
  }
  const cypher = fs.readFileSync(absolute, "utf8");
  if (!cypher.trim()) throw new Error(`Query file is empty: ${queryPath}`);
  return { cypher };
}

function isVisualizationSpecV1(value: unknown): value is ProjectVisualizationSpecV1 {
  if (!value || typeof value !== "object") return false;
  const spec = value as Record<string, unknown>;
  if (
    spec.format !== VISUALIZATION_SPEC_FORMAT_V1 ||
    typeof spec.name !== "string" ||
    typeof spec.result !== "string"
  ) {
    return false;
  }
  if (spec.kind === "result-graph") {
    const graph = spec.graph as Record<string, unknown> | undefined;
    return graph?.renderer === "cytoscape" || graph?.renderer === "sigma";
  }
  if (spec.kind === "plotly") {
    const plotly = spec.plotly as Record<string, unknown> | undefined;
    return (
      typeof plotly?.chartType === "string" &&
      typeof plotly.x === "string" &&
      (plotly.chartType === "histogram" || typeof plotly.y === "string")
    );
  }
  return false;
}

export function isVisualizationSpec(value: unknown): value is ProjectVisualizationSpec {
  return isVisualizationSpecV1(value) || isVisualizationSpecV2(value);
}

export function readProjectVisualization(
  projectRoot: string,
  visualizationPath: string,
): ProjectVisualizationSpec {
  const absolute = resolveProjectArtifactPath(projectRoot, visualizationPath);
  const parsed: unknown = JSON.parse(fs.readFileSync(absolute, "utf8"));
  if (!isVisualizationSpec(parsed)) {
    throw new Error(`Invalid GraphForge visualization spec: ${visualizationPath}`);
  }
  return parsed;
}

export function filterQueryResult(result: QueryResult, filter?: ResultFilter): QueryResult {
  if (!filter?.column || !filter.value) return result;
  const needle = filter.value.toLocaleLowerCase();
  const rows = result.rows.filter((row) => {
    const value = row[filter.column];
    if (filter.operator === "equals") {
      return String(value ?? "").toLocaleLowerCase() === needle;
    }
    return String(value ?? "").toLocaleLowerCase().includes(needle);
  });
  return { ...result, rows, rowCount: rows.length };
}

export function filterQueryResultMany(
  result: QueryResult,
  filters: readonly ResultFilter[],
): QueryResult {
  return filters.reduce((current, filter) => filterQueryResult(current, filter), result);
}

export function scanProjectArtifacts(projectRoot: string): ProjectArtifactIndex {
  const queryFiles = listFiles(path.join(projectRoot, PROJECT_QUERIES_DIR), [
    ".cypher",
    ".cql",
    ".json",
  ]);
  const templateRoot = path.resolve(projectRoot, PROJECT_QUERY_TEMPLATES_DIR);
  const isTemplate = (file: string) => {
    const relative = path.relative(templateRoot, file);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  };
  const queries = queryFiles
    .filter((file) => !isTemplate(file))
    .map((file) => artifactEntry(projectRoot, file));
  const queryTemplates = queryFiles
    .filter(isTemplate)
    .map((file) => artifactEntry(projectRoot, file));
  const mutations = listFiles(path.join(projectRoot, PROJECT_MUTATIONS_DIR), [
    ".cypher",
    ".cql",
    ".md",
    ".json",
  ]).map((file) => artifactEntry(projectRoot, file));
  const resultFiles = listFiles(path.join(projectRoot, PROJECT_RESULTS_DIR), [".json"]);
  const visibleResultFiles =
    resultFiles.length > 1
      ? resultFiles.filter((file) => path.basename(file).toLocaleLowerCase() !== "query-result.json")
      : resultFiles;
  const results = visibleResultFiles.flatMap(
    (file) => {
      try {
        const result = readProjectResult(projectRoot, file);
        return [{ ...artifactEntry(projectRoot, file), columns: result.columns, rowCount: result.rowCount }];
      } catch {
        return [];
      }
    },
  );
  const visualizations = listFiles(
    path.join(projectRoot, PROJECT_VISUALIZATIONS_DIR),
    [".json"],
  ).flatMap((file) => {
    try {
      const spec = readProjectVisualization(projectRoot, file);
      return [{
        ...artifactEntry(projectRoot, file),
        kind: spec.kind,
        result: spec.result,
      }];
    } catch {
      return [];
    }
  });
  return { queries, queryTemplates, results, visualizations, mutations };
}

/** UTC timestamp used by all unnamed project artifacts: YYYYMMDD-HHMMSS-mmm. */
export function artifactTimestamp(date: Date = new Date()): string {
  const iso = date.toISOString();
  return (
    iso.slice(0, 4) +
    iso.slice(5, 7) +
    iso.slice(8, 10) +
    "-" +
    iso.slice(11, 13) +
    iso.slice(14, 16) +
    iso.slice(17, 19) +
    "-" +
    iso.slice(20, 23)
  );
}

export function defaultArtifactName(prefix: "query" | "results" | "vis", date = new Date()): string {
  return `${prefix}-${artifactTimestamp(date)}`;
}

export function resolveArtifactName(
  name: string | undefined,
  prefix: "query" | "results" | "vis",
  date = new Date(),
): string {
  return name?.trim() || defaultArtifactName(prefix, date);
}

export function projectArtifactFileName(
  name: string | undefined,
  prefix: "query" | "results" | "vis",
  extension: string,
  date = new Date(),
): string {
  const resolvedName = resolveArtifactName(name, prefix, date);
  const stem = path
    .basename(resolvedName, path.extname(resolvedName))
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!stem) throw new Error("Choose a file name with at least one letter or number.");
  return `${stem}${extension}`;
}

export function writeProjectQuery(
  projectRoot: string,
  name: string | undefined,
  cypher: string,
): string {
  if (!cypher.trim()) throw new Error("Query text cannot be empty.");
  const filePath = path.join(
    projectRoot,
    PROJECT_QUERIES_DIR,
    projectArtifactFileName(name, "query", ".cypher"),
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${cypher.trim()}\n`, "utf8");
  return relativeProjectPath(projectRoot, filePath);
}

export function writeProjectQueryTemplate(
  projectRoot: string,
  name: string | undefined,
  cypher: string,
): string {
  if (!cypher.trim()) throw new Error("Query text cannot be empty.");
  const filePath = path.join(
    projectRoot,
    PROJECT_QUERY_TEMPLATES_DIR,
    projectArtifactFileName(name, "query", ".cypher"),
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${cypher.trim()}\n`, "utf8");
  return relativeProjectPath(projectRoot, filePath);
}

/** Persist a standalone, rerunnable graph mutation without overwriting prior edits. */
export function writeProjectMutation(
  projectRoot: string,
  name: string,
  cypher: string,
): string {
  if (!cypher.trim()) throw new Error("Mutation text cannot be empty.");
  const fileName = projectArtifactFileName(name, "query", ".cypher");
  const parsed = path.parse(fileName);
  let filePath = path.join(projectRoot, PROJECT_MUTATIONS_DIR, fileName);
  let suffix = 2;
  while (fs.existsSync(filePath)) {
    filePath = path.join(
      projectRoot,
      PROJECT_MUTATIONS_DIR,
      `${parsed.name}-${suffix}${parsed.ext}`,
    );
    suffix += 1;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${cypher.trim()}\n`, "utf8");
  return relativeProjectPath(projectRoot, filePath);
}

export function writeProjectVisualization(
  projectRoot: string,
  name: string | undefined,
  spec: ProjectVisualizationSpec,
): string {
  const resolvedName = resolveArtifactName(name, "vis");
  const resolvedSpec = { ...spec, name: resolvedName } as ProjectVisualizationSpec;
  if (!isVisualizationSpec(resolvedSpec)) {
    throw new Error("Visualization settings are incomplete.");
  }
  resolveProjectArtifactPath(projectRoot, resolvedSpec.result);
  const filePath = path.join(
    projectRoot,
    PROJECT_VISUALIZATIONS_DIR,
    projectArtifactFileName(resolvedName, "vis", ".gfviz.json"),
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(resolvedSpec, null, 2)}\n`, "utf8");
  return relativeProjectPath(projectRoot, filePath);
}

/** Replace one existing visualization artifact after validating its complete spec. */
export function replaceProjectVisualization(
  projectRoot: string,
  visualizationPath: string,
  spec: ProjectVisualizationSpec,
): string {
  if (!isVisualizationSpec(spec)) {
    throw new Error("Visualization settings are incomplete or unsafe.");
  }
  resolveProjectArtifactPath(projectRoot, spec.result);
  const filePath = resolveProjectArtifactPath(projectRoot, visualizationPath);
  const visualizationRoot = path.join(projectRoot, PROJECT_VISUALIZATIONS_DIR);
  if (!isInsideProject(visualizationRoot, filePath) || !filePath.endsWith(".gfviz.json")) {
    throw new Error(`Visualization must stay inside ${PROJECT_VISUALIZATIONS_DIR}/ and end in .gfviz.json.`);
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`Visualization does not exist: ${relativeProjectPath(projectRoot, filePath)}.`);
  }
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
  return relativeProjectPath(projectRoot, filePath);
}
