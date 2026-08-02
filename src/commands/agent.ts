import * as path from "node:path";
import * as vscode from "vscode";
import {
  AGENT_CONTEXT_FORMAT,
  ARTIFACT_INDEX_FORMAT,
  buildAgentProjectContext,
  type AgentProjectContext,
} from "../session/agentContext";
import type { EnvironmentReport } from "../session/environmentReport";
import type { GraphForgeSession } from "../session/graphForgeSession";
import { buildEnvironmentReport } from "./setup";

type PathLike = string | vscode.Uri;

export interface AgentContextArgs {
  /** Inspect this project without opening it. Defaults to the active project. */
  projectPath?: PathLike;
}

export interface AgentCommandDescriptor {
  id: string;
  args: string;
  returns: string;
}

/** Small, stable operating surface agents can discover from one command call. */
export const AGENT_OPERATION_COMMANDS: readonly AgentCommandDescriptor[] = [
  {
    id: "graphforge.agent.getContext",
    args: "{ projectPath?: string | Uri }",
    returns: "graphforge.agent-context/v1",
  },
  {
    id: "graphforge.agent.listArtifacts",
    args: "{ projectPath?: string | Uri }",
    returns: "graphforge.artifact-index/v1",
  },
  {
    id: "graphforge.openSampleProject",
    args: "{ path?: string; force?: boolean }",
    returns: "{ path, project, seeded }",
  },
  {
    id: "graphforge.openProject",
    args: "string | Uri | { path: string | Uri }",
    returns: "{ path, project }",
  },
  {
    id: "graphforge.runProjectQuery",
    args: "string | Uri | { path: string | Uri; resultName?: string }",
    returns: "QueryResult",
  },
  {
    id: "graphforge.applyProjectMutation",
    args: "{ path: string | Uri; confirm: true }",
    returns: "{ path, absolutePath, columns, rowCount }",
  },
  {
    id: "graphforge.importData",
    args: "{ path: string | Uri; label: string; mode?: 'create' | 'merge'; idColumn?: string; confirm: true }",
    returns: "{ path, format, label, mode, imported, result }",
  },
  {
    id: "graphforge.openProjectResult",
    args: "string | Uri | { path: string | Uri }",
    returns: "{ path, absolutePath, columns, rowCount }",
  },
  {
    id: "graphforge.openProjectVisualization",
    args: "string | Uri | { path: string | Uri }",
    returns: "Visualization open outcome",
  },
] as const;

function pathValue(value: PathLike | undefined): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  return value?.fsPath;
}

function effectiveSettings(): Record<string, unknown> {
  const config = vscode.workspace.getConfiguration("graphforge");
  return {
    runtime: config.get("runtime"),
    engineVersion: config.get("engineVersion"),
    nativeModulePath: config.get("nativeModulePath"),
    pythonInterpreterPath: config.get("pythonInterpreterPath"),
    experienceMode: config.get("experienceMode"),
    openResultGraphOnQuery: config.get("openResultGraphOnQuery"),
    resultGraphRenderer: config.get("resultGraph.renderer"),
    figureLimitsEnabled: config.get("figureLimitsEnabled"),
    figureMaxTraces: config.get("figureMaxTraces"),
    figureMaxPoints: config.get("figureMaxPoints"),
    figureMaxBytes: config.get("figureMaxBytes"),
  };
}

async function buildContext(
  session: GraphForgeSession,
  args?: AgentContextArgs,
): Promise<{
  format: typeof AGENT_CONTEXT_FORMAT;
  timestamp: string;
  environment: EnvironmentReport;
  discoveredProjects: Array<{ name: string; path: string }>;
  project?: AgentProjectContext & { open: boolean };
  settings: Record<string, unknown>;
  commands: readonly AgentCommandDescriptor[];
  contracts: {
    query: string;
    result: string;
    visualization: string;
    mutation: string;
    import: string;
  };
}> {
  const [environment, discovered] = await Promise.all([
    buildEnvironmentReport(session),
    session.listProjects(),
  ]);
  const explicitPath = pathValue(args?.projectPath);
  const rootPath = explicitPath ? path.resolve(explicitPath) : session.project?.rootPath;
  const activeRootPath = session.project?.rootPath
    ? path.resolve(session.project.rootPath)
    : undefined;
  const discoveredProject = rootPath
    ? discovered.find((candidate) => path.resolve(candidate.rootPath) === rootPath)
    : undefined;
  const project = rootPath
    ? {
        ...buildAgentProjectContext(rootPath, {
          name: discoveredProject?.name ?? session.project?.name,
          hasLastResult: activeRootPath === rootPath && session.hasLastResult,
        }),
        open: activeRootPath === rootPath,
      }
    : undefined;

  return {
    format: AGENT_CONTEXT_FORMAT,
    timestamp: new Date().toISOString(),
    environment,
    discoveredProjects: discovered.map((candidate) => ({
      name: candidate.name,
      path: path.resolve(candidate.rootPath),
    })),
    project,
    settings: effectiveSettings(),
    commands: AGENT_OPERATION_COMMANDS,
    contracts: {
      query: ".cypher/.cql text, or JSON { cypher: string, params?: object }",
      result: "JSON { columns: string[], rows: object[], rowCount: number }",
      visualization: "graphforge.visualization/v1 .gfviz.json",
      mutation: ".cypher/.cql text, applied only with explicit confirm: true",
      import: "CSV/JSON/JSONL/NDJSON objects, imported only with explicit confirm: true",
    },
  };
}

export function registerAgentCommands(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "graphforge.agent.getContext",
      (args?: AgentContextArgs) => buildContext(session, args),
    ),
    vscode.commands.registerCommand(
      "graphforge.agent.listArtifacts",
      async (args?: AgentContextArgs) => {
        const agentContext = await buildContext(session, args);
        if (!agentContext.project) {
          return {
            error: "No GraphForge project is open or specified.",
            code: "PROJECT_REQUIRED",
            nextAction: "Call graphforge.openProject(path) or pass { projectPath }.",
          };
        }
        return {
          format: ARTIFACT_INDEX_FORMAT,
          timestamp: agentContext.timestamp,
          project: {
            name: agentContext.project.name,
            rootPath: agentContext.project.rootPath,
            marker: agentContext.project.marker,
          },
          artifacts: agentContext.project.artifacts,
        };
      },
    ),
  );
}
