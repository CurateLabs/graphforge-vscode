import { LEGACY_RESULT_BYTES, RESULT_METADATA_BYTES, RESULT_METADATA_FORMAT, resultMetadataPath } from "./resultMetadata";
import { decodeTable } from "./arrowCodec";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import type { QueryResult, TableRow } from "./types";
import {
  isVisualizationSpec,
  type ProjectVisualizationSpec,
} from "./visualizationRegistry";
export { isVisualizationSpec } from "./visualizationRegistry";
export type { ProjectVisualizationSpec } from "./visualizationRegistry";

export const PROJECT_QUERIES_DIR = "queries";
export const PROJECT_QUERY_TEMPLATES_DIR = "queries/templates";
export const PROJECT_NOTEBOOKS_DIR = "notebooks";
export const PROJECT_APPS_DIR = "apps";
export const PROJECT_RESULTS_DIR = "results";
export const PROJECT_VISUALIZATIONS_DIR = "visualizations";
export const PROJECT_MUTATIONS_DIR = "mutations";

export interface ProjectArtifactEntry {
  name: string;
  path: string;
}

export interface ProjectResultEntry extends ProjectArtifactEntry {
  columns: string[];
  rowCount: number;
  hasArrow: boolean;
  sourceQuery?: string;
}

export interface ProjectVisualizationEntry extends ProjectArtifactEntry {
  kind: ProjectVisualizationSpec["kind"];
  result: string;
  format: ProjectVisualizationSpec["format"];
  renderer: string;
}

export interface ProjectArtifactIndex {
  queries: ProjectArtifactEntry[];
  queryTemplates: ProjectArtifactEntry[];
  notebooks: ProjectArtifactEntry[];
  apps: ProjectArtifactEntry[];
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

function isInsideProject(projectRoot: string, candidate: string): boolean {
  const relative = path.relative(
    path.resolve(projectRoot),
    path.resolve(candidate),
  );
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/** Resolve a project-relative path and reject traversal/out-of-project paths. */
export function resolveProjectArtifactPath(
  projectRoot: string,
  artifactPath: string,
): string {
  const resolved = path.isAbsolute(artifactPath)
    ? path.resolve(artifactPath)
    : path.resolve(projectRoot, artifactPath);
  if (!isInsideProject(projectRoot, resolved)) {
    throw new Error(
      `Artifact path must stay inside the open project: ${artifactPath}`,
    );
  }
  return resolved;
}

/** Resolve an executable mutation and require it to live under `mutations/`. */
export function resolveProjectMutationPath(
  projectRoot: string,
  mutationPath: string,
): string {
  const resolved = resolveProjectArtifactPath(projectRoot, mutationPath);
  const mutationRoot = path.join(projectRoot, PROJECT_MUTATIONS_DIR);
  if (!isInsideProject(mutationRoot, resolved)) {
    throw new Error(
      `Mutation path must stay inside ${PROJECT_MUTATIONS_DIR}/: ${mutationPath}`,
    );
  }
  if (
    ![".cypher", ".cql", ".json"].includes(path.extname(resolved).toLowerCase())
  ) {
    throw new Error(
      `Mutation must be a .cypher, .cql, or .json query spec: ${mutationPath}`,
    );
  }
  return resolved;
}

export function relativeProjectPath(
  projectRoot: string,
  artifactPath: string,
): string {
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
    .filter(
      (file) =>
        !extensions || extensions.includes(path.extname(file).toLowerCase()),
    )
    .sort((a, b) => a.localeCompare(b));
}

function artifactEntry(
  projectRoot: string,
  filePath: string,
): ProjectArtifactEntry {
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
  if (
    !Array.isArray(record.columns) ||
    !record.columns.every((item) => typeof item === "string")
  ) {
    throw new Error(`Result columns must be strings: ${source}`);
  }
  if (
    !Array.isArray(record.rows) ||
    !record.rows.every((item) => item && typeof item === "object")
  ) {
    throw new Error(`Result rows must be objects: ${source}`);
  }
  return {
    columns: record.columns as string[],
    rows: record.rows as TableRow[],
    rowCount:
      typeof record.rowCount === "number"
        ? record.rowCount
        : record.rows.length,
    generationUuid:
      typeof record.generationUuid === "string"
        ? record.generationUuid
        : undefined,
    sourceQuery: typeof record.sourceQuery === "string" ? record.sourceQuery : undefined,
  };
}

export function readProjectResult(
  projectRoot: string,
  resultPath: string,
): QueryResult {
  const absolute = resolveProjectArtifactPath(projectRoot, resultPath);
  const readBounded = (file: string, limit: number): string => {
    // Bound the actual read as well as the stat: an externally edited file may grow.
    const handle = fs.openSync(file, "r");
    try {
      const bytes = Buffer.alloc(Math.min(fs.fstatSync(handle).size, limit) + 1);
      let count = 0;
      while (count < bytes.length) {
        const size = fs.readSync(handle, bytes, count, bytes.length - count, count);
        if (!size) break;
        count += size;
      }
      if (count > limit || fs.fstatSync(handle).size > limit)
        throw new Error("RESULT_DOCUMENT_TOO_LARGE: Run the query again to save Arrow-backed results; the original JSON file remains available in the editor.");
      return bytes.subarray(0, count).toString("utf8");
    } finally { fs.closeSync(handle); }
  };
  const pointerPath = resultMetadataPath(absolute);
  const hasPointer = fs.existsSync(pointerPath);
  const saved = JSON.parse(readBounded(hasPointer ? pointerPath : absolute,
    hasPointer ? RESULT_METADATA_BYTES : LEGACY_RESULT_BYTES));
  if (!saved || typeof saved !== "object" || Array.isArray(saved) ||
      (hasPointer && (saved.format !== RESULT_METADATA_FORMAT ||
        !Number.isSafeInteger(saved.rowCount) || saved.rowCount < 0 ||
        (saved.arrowSha256 !== undefined && (typeof saved.arrowSha256 !== "string" || !/^[a-f0-9]{64}$/.test(saved.arrowSha256))) ||
        (saved.generationUuid !== undefined && typeof saved.generationUuid !== "string") ||
        (saved.sourceQuery !== undefined && typeof saved.sourceQuery !== "string"))))
    throw new Error("RESULT_METADATA_INVALID: Run the query again to restore the saved result metadata.");
  if (typeof saved.arrowSha256 === "string") {
    const ipc = fs.readFileSync(resolveProjectArtifactPath(projectRoot, absolute.replace(/\.json$/i, ".arrow")));
    if (createHash("sha256").update(ipc).digest("hex") !== saved.arrowSha256)
      throw new Error("XYG_RESULT_MISMATCH: Saved metadata and Arrow differ. Rerun the query.");
    const result = decodeTable(ipc);
    if (hasPointer && result.rowCount !== saved.rowCount)
      throw new Error("XYG_RESULT_MISMATCH: Saved metadata and Arrow row counts differ. Rerun the query.");
    return { ...result, generationUuid: saved.generationUuid, sourceQuery: saved.sourceQuery };
  }
  const text = hasPointer ? readBounded(absolute, LEGACY_RESULT_BYTES) : undefined;
  if (hasPointer && (typeof saved.jsonSha256 !== "string" ||
      createHash("sha256").update(text!).digest("hex") !== saved.jsonSha256))
    throw new Error("XYG_RESULT_MISMATCH: Saved metadata and JSON differ. Rerun the query.");
  return parseQueryResult(hasPointer ? JSON.parse(text!) : saved, resultPath);
}

export function readProjectQuery(
  projectRoot: string,
  queryPath: string,
): ProjectQuery {
  const absolute = resolveProjectArtifactPath(projectRoot, queryPath);
  if (absolute.endsWith(".json")) {
    const parsed = JSON.parse(fs.readFileSync(absolute, "utf8")) as Record<
      string,
      unknown
    >;
    if (typeof parsed.cypher !== "string" || !parsed.cypher.trim()) {
      throw new Error(
        `Query spec requires a non-empty "cypher" string: ${queryPath}`,
      );
    }
    const params =
      parsed.params &&
      typeof parsed.params === "object" &&
      !Array.isArray(parsed.params)
        ? (parsed.params as Record<string, unknown>)
        : undefined;
    return { cypher: parsed.cypher, params };
  }
  const cypher = fs.readFileSync(absolute, "utf8");
  if (!cypher.trim()) throw new Error(`Query file is empty: ${queryPath}`);
  return { cypher };
}

export function readProjectVisualization(
  projectRoot: string,
  visualizationPath: string,
): ProjectVisualizationSpec {
  const absolute = resolveProjectArtifactPath(projectRoot, visualizationPath);
  const parsed: unknown = JSON.parse(fs.readFileSync(absolute, "utf8"));
  if (!isVisualizationSpec(parsed)) {
    throw new Error(
      `Invalid GraphForge visualization spec: ${visualizationPath}`,
    );
  }
  assertSupportedVisualization(parsed);
  return parsed;
}

/** Validate capabilities the editor can host before saving or applying filters. */
function assertSupportedVisualization(spec: ProjectVisualizationSpec): void {
  if (spec.kind === "result-graph" && spec.filters.length) {
    throw new Error("XYG_GRAPH_FILTER_REQUIRED: Filter graph entities in the Cypher query, then run it again.");
  }
}

export function filterQueryResult(
  result: QueryResult,
  filter?: ResultFilter,
): QueryResult {
  if (!filter?.column || !filter.value) return result;
  const needle = filter.value.toLocaleLowerCase();
  const rows = result.rows.filter((row) => {
    const value = row[filter.column];
    if (filter.operator === "equals") {
      return String(value ?? "").toLocaleLowerCase() === needle;
    }
    return String(value ?? "")
      .toLocaleLowerCase()
      .includes(needle);
  });
  // A row filter cannot keep the unfiltered canonical IPC as its own data.
  return { ...result, rows, rowCount: rows.length, ipc: undefined };
}

export function filterQueryResultMany(
  result: QueryResult,
  filters: readonly ResultFilter[],
): QueryResult {
  return filters.reduce(
    (current, filter) => filterQueryResult(current, filter),
    result,
  );
}

export function scanProjectArtifacts(
  projectRoot: string,
): ProjectArtifactIndex {
  const queryFiles = listFiles(path.join(projectRoot, PROJECT_QUERIES_DIR), [
    ".cypher",
    ".cql",
    ".json",
  ]);
  const templateRoot = path.resolve(projectRoot, PROJECT_QUERY_TEMPLATES_DIR);
  const isTemplate = (file: string) => {
    const relative = path.relative(templateRoot, file);
    return (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  };
  const queries = queryFiles
    .filter((file) => !isTemplate(file))
    .map((file) => artifactEntry(projectRoot, file));
  const queryTemplates = queryFiles
    .filter(isTemplate)
    .map((file) => artifactEntry(projectRoot, file));
  const notebooks = listFiles(path.join(projectRoot, PROJECT_NOTEBOOKS_DIR), [
    ".ipynb",
  ]).map((file) => artifactEntry(projectRoot, file));
  const apps = listFiles(path.join(projectRoot, PROJECT_APPS_DIR), [".py"]).map(
    (file) => artifactEntry(projectRoot, file),
  );
  const mutations = listFiles(path.join(projectRoot, PROJECT_MUTATIONS_DIR), [
    ".cypher",
    ".cql",
    ".md",
    ".json",
  ]).map((file) => artifactEntry(projectRoot, file));
  const resultFiles = listFiles(path.join(projectRoot, PROJECT_RESULTS_DIR), [
    ".json",
  ]);
  const results = resultFiles.flatMap((file) => {
    try {
      const result = readProjectResult(projectRoot, file);
      return [
        {
          ...artifactEntry(projectRoot, file),
          columns: result.columns,
          rowCount: result.rowCount,
          hasArrow: !!result.ipc,
          // Only offer navigation to an existing query, never execute metadata.
          sourceQuery: result.sourceQuery && queryFiles.some(file =>
            relativeProjectPath(projectRoot, file) === result.sourceQuery)
            ? result.sourceQuery : undefined,
        },
      ];
    } catch {
      return [];
    }
  });
  const visualizations = listFiles(
    path.join(projectRoot, PROJECT_VISUALIZATIONS_DIR),
    [".json"],
  ).flatMap((file) => {
    try {
      const spec = readProjectVisualization(projectRoot, file);
      return [
        {
          ...artifactEntry(projectRoot, file),
          kind: spec.kind,
          result: spec.result,
          format: spec.format,
          renderer: "xyg",
        },
      ];
    } catch {
      return [];
    }
  });
  return {
    queries,
    queryTemplates,
    notebooks,
    apps,
    results,
    visualizations,
    mutations,
  };
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

export function defaultArtifactName(
  prefix: "query" | "results" | "vis",
  date = new Date(),
): string {
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
  if (!stem)
    throw new Error("Choose a file name with at least one letter or number.");
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
  params?: Record<string, unknown>,
): string {
  if (!cypher.trim()) throw new Error("Mutation text cannot be empty.");
  const fileName = projectArtifactFileName(
    name,
    "query",
    params ? ".json" : ".cypher",
  );
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
  fs.writeFileSync(
    filePath,
    params
      ? JSON.stringify({ cypher: cypher.trim(), params }, null, 2) + "\n"
      : `${cypher.trim()}\n`,
    "utf8",
  );
  return relativeProjectPath(projectRoot, filePath);
}

export function writeProjectVisualization(
  projectRoot: string,
  name: string | undefined,
  spec: ProjectVisualizationSpec,
): string {
  const resolvedName = resolveArtifactName(name, "vis");
  const resolvedSpec = {
    ...spec,
    name: resolvedName,
  } as ProjectVisualizationSpec;
  if (!isVisualizationSpec(resolvedSpec)) {
    throw new Error("Visualization settings are incomplete.");
  }
  assertSupportedVisualization(resolvedSpec);
  resolveProjectArtifactPath(projectRoot, resolvedSpec.result);
  const filePath = path.join(
    projectRoot,
    PROJECT_VISUALIZATIONS_DIR,
    projectArtifactFileName(resolvedName, "vis", ".gfviz.json"),
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(resolvedSpec, null, 2)}\n`,
    "utf8",
  );
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
  assertSupportedVisualization(spec);
  resolveProjectArtifactPath(projectRoot, spec.result);
  const filePath = resolveProjectArtifactPath(projectRoot, visualizationPath);
  const visualizationRoot = path.join(projectRoot, PROJECT_VISUALIZATIONS_DIR);
  if (
    !isInsideProject(visualizationRoot, filePath) ||
    !filePath.endsWith(".gfviz.json")
  ) {
    throw new Error(
      `Visualization must stay inside ${PROJECT_VISUALIZATIONS_DIR}/ and end in .gfviz.json.`,
    );
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Visualization does not exist: ${relativeProjectPath(projectRoot, filePath)}.`,
    );
  }
  const canonicalProjectRoot = fs.realpathSync(projectRoot);
  const canonicalVisualizationRoot = fs.realpathSync(visualizationRoot);
  if (!isInsideProject(canonicalProjectRoot, canonicalVisualizationRoot)) {
    throw new Error(
      `Visualization directory must stay inside the open project.`,
    );
  }
  const canonicalParent = fs.realpathSync(path.dirname(filePath));
  if (!isInsideProject(canonicalVisualizationRoot, canonicalParent)) {
    throw new Error(
      `Visualization must stay inside ${PROJECT_VISUALIZATIONS_DIR}/.`,
    );
  }
  const canonicalFilePath = path.join(canonicalParent, path.basename(filePath));
  const temporaryPath = `${canonicalFilePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(
      temporaryPath,
      `${JSON.stringify(spec, null, 2)}\n`,
      "utf8",
    );
    fs.renameSync(temporaryPath, canonicalFilePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
  return relativeProjectPath(projectRoot, filePath);
}
