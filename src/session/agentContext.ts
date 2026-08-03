import * as fs from "node:fs";
import * as path from "node:path";
import {
  PROJECT_MUTATIONS_DIR,
  PROJECT_NOTEBOOKS_DIR,
  PROJECT_QUERIES_DIR,
  PROJECT_QUERY_TEMPLATES_DIR,
  PROJECT_RESULTS_DIR,
  PROJECT_VISUALIZATIONS_DIR,
  scanProjectArtifacts,
  type ProjectArtifactEntry,
  type ProjectArtifactIndex,
  type ProjectResultEntry,
  type ProjectVisualizationEntry,
} from "./projectArtifacts";
import { isGraphForgeProject, readCurrentPointer } from "./projectFormat";
import { FORMAT_FILE, PROJECT_FORMAT_BYTES } from "./types";

export const AGENT_CONTEXT_FORMAT = "graphforge.agent-context/v1";
export const ARTIFACT_INDEX_FORMAT = "graphforge.artifact-index/v1";

export type AgentArtifactEntry = ProjectArtifactEntry & { absolutePath: string };
export type AgentResultEntry = ProjectResultEntry & { absolutePath: string };
export type AgentVisualizationEntry = ProjectVisualizationEntry & { absolutePath: string };

export interface AgentArtifactIndex {
  queries: AgentArtifactEntry[];
  queryTemplates: AgentArtifactEntry[];
  notebooks: AgentArtifactEntry[];
  results: AgentResultEntry[];
  visualizations: AgentVisualizationEntry[];
  mutations: AgentArtifactEntry[];
}

export interface AgentProjectContext {
  rootPath: string;
  name: string;
  marker: {
    path: string;
    expected: string;
    valid: boolean;
  };
  current?: ReturnType<typeof readCurrentPointer>;
  instructionsPath?: string;
  directories: {
    queries: string;
    queryTemplates: string;
    notebooks: string;
    results: string;
    visualizations: string;
    mutations: string;
  };
  artifacts: AgentArtifactIndex;
  lastResult: {
    inMemory: boolean;
    canonicalJsonPath: string;
    canonicalMarkdownPath: string;
    exists: boolean;
    latestHistoryPath?: string;
  };
}

function withAbsolutePath<T extends ProjectArtifactEntry>(
  projectRoot: string,
  entries: T[],
): Array<T & { absolutePath: string }> {
  return entries.map((entry) => ({
    ...entry,
    absolutePath: path.resolve(projectRoot, entry.path),
  }));
}

export function enrichArtifactIndex(
  projectRoot: string,
  index: ProjectArtifactIndex,
): AgentArtifactIndex {
  return {
    queries: withAbsolutePath(projectRoot, index.queries),
    queryTemplates: withAbsolutePath(projectRoot, index.queryTemplates),
    notebooks: withAbsolutePath(projectRoot, index.notebooks),
    results: withAbsolutePath(projectRoot, index.results),
    visualizations: withAbsolutePath(projectRoot, index.visualizations),
    mutations: withAbsolutePath(projectRoot, index.mutations),
  };
}

function latestResultPath(results: AgentResultEntry[]): string | undefined {
  let latest: { path: string; modified: number } | undefined;
  for (const result of results) {
    // Canonical last-result aliases are exposed separately; history picks only
    // durable timestamped result files.
    if (path.basename(result.path) === "query-result.json") {
      continue;
    }
    try {
      const modified = fs.statSync(result.absolutePath).mtimeMs;
      if (!latest || modified > latest.modified) {
        latest = { path: result.absolutePath, modified };
      }
    } catch {
      // A file may disappear between scanning and stat; omit it from latest.
    }
  }
  return latest?.path;
}

/** Build the stable, JSON-serializable project portion of agent context. */
export function buildAgentProjectContext(
  projectRoot: string,
  options: { name?: string; hasLastResult?: boolean } = {},
): AgentProjectContext {
  const rootPath = path.resolve(projectRoot);
  const artifacts = enrichArtifactIndex(rootPath, scanProjectArtifacts(rootPath));
  const canonicalJsonPath = path.join(rootPath, PROJECT_RESULTS_DIR, "query-result.json");
  const canonicalMarkdownPath = path.join(rootPath, PROJECT_RESULTS_DIR, "query-result.md");
  const instructionsPath = path.join(rootPath, "AGENTS.md");

  return {
    rootPath,
    name: options.name ?? path.basename(rootPath),
    marker: {
      path: path.join(rootPath, FORMAT_FILE),
      expected: PROJECT_FORMAT_BYTES.toString("utf8"),
      valid: isGraphForgeProject(rootPath),
    },
    current: readCurrentPointer(rootPath),
    instructionsPath: fs.existsSync(instructionsPath) ? instructionsPath : undefined,
    directories: {
      queries: path.join(rootPath, PROJECT_QUERIES_DIR),
      queryTemplates: path.join(rootPath, PROJECT_QUERY_TEMPLATES_DIR),
      notebooks: path.join(rootPath, PROJECT_NOTEBOOKS_DIR),
      results: path.join(rootPath, PROJECT_RESULTS_DIR),
      visualizations: path.join(rootPath, PROJECT_VISUALIZATIONS_DIR),
      mutations: path.join(rootPath, PROJECT_MUTATIONS_DIR),
    },
    artifacts,
    lastResult: {
      inMemory: Boolean(options.hasLastResult),
      canonicalJsonPath,
      canonicalMarkdownPath,
      exists: fs.existsSync(canonicalJsonPath),
      latestHistoryPath: latestResultPath(artifacts.results),
    },
  };
}
