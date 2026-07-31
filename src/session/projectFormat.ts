import * as fs from "node:fs";
import * as path from "node:path";
import {
  CURRENT_FILE,
  CurrentPointer,
  FORMAT_FILE,
  PROJECT_FORMAT_BYTES,
  WorkspaceOntology,
} from "./types";

/** True only when FORMAT exists and matches PROJECT_FORMAT_BYTES exactly. */
export function isGraphForgeProject(rootPath: string): boolean {
  const formatPath = path.join(rootPath, FORMAT_FILE);
  try {
    const bytes = fs.readFileSync(formatPath);
    return bytes.equals(PROJECT_FORMAT_BYTES);
  } catch {
    return false;
  }
}

/** Directory entries, or undefined when the path does not exist / is not a directory. */
export function readDirSafe(rootPath: string): string[] | undefined {
  try {
    return fs.readdirSync(rootPath);
  } catch {
    return undefined;
  }
}

export type InitSafety =
  | { kind: "missing" }
  | { kind: "already-project" }
  | { kind: "empty" }
  | { kind: "non-empty"; entries: string[] };

/**
 * Best-effort local classification of whether `graphforge.initializeProjectHere`
 * is likely to succeed. The engine (`open_or_initialize_project`) is the source
 * of truth and fails closed on unsafe roots; this only shapes the confirmation
 * prompt so users are not surprised.
 */
export function classifyInitTarget(rootPath: string): InitSafety {
  if (isGraphForgeProject(rootPath)) {
    return { kind: "already-project" };
  }
  const entries = readDirSafe(rootPath);
  if (entries === undefined) {
    return { kind: "missing" };
  }
  if (entries.length === 0) {
    return { kind: "empty" };
  }
  return { kind: "non-empty", entries };
}

export function readCurrentPointer(rootPath: string): CurrentPointer | undefined {
  const currentPath = path.join(rootPath, CURRENT_FILE);
  try {
    const text = fs.readFileSync(currentPath, "utf8").trim();
    const parsed = JSON.parse(text) as CurrentPointer;
    if (parsed.format !== "graphforge-project" || parsed.format_version !== 1) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function readWorkspaceOntology(
  rootPath: string,
  generationUuid?: string,
): WorkspaceOntology | undefined {
  const uuid = generationUuid ?? readCurrentPointer(rootPath)?.generation_uuid;
  if (!uuid) {
    return undefined;
  }
  const ontologyPath = path.join(
    rootPath,
    "generations",
    uuid,
    "participants",
    "workspace",
    "ontology.json",
  );
  try {
    return JSON.parse(fs.readFileSync(ontologyPath, "utf8")) as WorkspaceOntology;
  } catch {
    return undefined;
  }
}

export function readManifestCapabilities(
  rootPath: string,
  generationUuid?: string,
): string[] {
  const uuid = generationUuid ?? readCurrentPointer(rootPath)?.generation_uuid;
  if (!uuid) {
    return [];
  }
  const manifestPath = path.join(rootPath, "generations", uuid, "manifest.json");
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      capabilities?: Array<{ name?: string } | string>;
      participants?: Record<string, unknown>;
    };
    if (Array.isArray(manifest.capabilities)) {
      return manifest.capabilities.map((c) =>
        typeof c === "string" ? c : (c.name ?? JSON.stringify(c)),
      );
    }
    if (manifest.participants && typeof manifest.participants === "object") {
      return Object.keys(manifest.participants);
    }
    return [];
  } catch {
    return [];
  }
}
