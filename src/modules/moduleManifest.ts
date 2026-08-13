export const GRAPHFORGE_MODULE_FORMAT = "graphforge.module/v1" as const;

export type ModuleCapability = "query" | "visualize" | "import" | "integration";

export interface ModuleCommandContribution {
  capability: ModuleCapability;
  command: string;
  title: string;
}

export type ModuleEntrypoint =
  | { kind: "builtin" }
  | {
      kind: "graphforge";
      capabilityId: string;
      commands?: ModuleCommandContribution[];
    }
  | { kind: "workspace-script"; script: string }
  | { kind: "commands"; commands: ModuleCommandContribution[] };

export interface GraphForgeModuleManifest {
  format: typeof GRAPHFORGE_MODULE_FORMAT;
  id: string;
  name: string;
  version: string;
  publisher: string;
  description: string;
  capabilities: ModuleCapability[];
  entrypoint: ModuleEntrypoint;
  homepage?: string;
}

export type ModuleSource =
  | { kind: "first-party" }
  | { kind: "graphforge"; capabilityId: string }
  | { kind: "sideload"; manifestPath: string };

export interface InstalledModuleRecord {
  manifest: GraphForgeModuleManifest;
  source: ModuleSource;
  enabled: boolean;
  installedAt: string;
}

export class ModuleManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModuleManifestError";
  }
}

const CAPABILITIES = new Set<ModuleCapability>([
  "query",
  "visualize",
  "import",
  "integration",
]);
const MODULE_ID = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const COMMAND_ID = /^[a-z0-9][a-z0-9._-]*$/i;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ModuleManifestError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ModuleManifestError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function homepage(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const raw = text(value, "homepage");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ModuleManifestError("homepage must be an absolute HTTP(S) URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ModuleManifestError("homepage must be an absolute HTTP(S) URL.");
  }
  return url.toString();
}

function parseCapabilities(value: unknown): ModuleCapability[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ModuleManifestError("capabilities must contain at least one capability.");
  }
  const values = value.map((item) => text(item, "capability"));
  for (const capability of values) {
    if (!CAPABILITIES.has(capability as ModuleCapability)) {
      throw new ModuleManifestError(`Unsupported capability: ${capability}.`);
    }
  }
  return [...new Set(values)] as ModuleCapability[];
}

function parseEntrypoint(value: unknown): ModuleEntrypoint {
  const raw = object(value, "entrypoint");
  const kind = text(raw.kind, "entrypoint.kind");
  if (kind === "builtin") return { kind };
  if (kind === "graphforge") {
    const capabilityId = text(raw.capabilityId, "entrypoint.capabilityId");
    const commands = raw.commands === undefined ? undefined : parseCommands(raw.commands);
    return { kind, capabilityId, ...(commands ? { commands } : {}) };
  }
  if (kind === "workspace-script") {
    const script = text(raw.script, "entrypoint.script").replace(/\\/g, "/");
    const parts = script.split("/");
    if (
      script.startsWith("/") ||
      /^[A-Za-z]:\//.test(script) ||
      parts.includes("..") ||
      !/\.(?:c?js)$/.test(script)
    ) {
      throw new ModuleManifestError(
        "entrypoint.script must be a relative .js or .cjs path inside the module folder.",
      );
    }
    return { kind, script: script.replace(/^\.\//, "") };
  }
  if (kind === "commands") {
    return { kind, commands: parseCommands(raw.commands) };
  }
  throw new ModuleManifestError(`Unsupported entrypoint kind: ${kind}.`);
}

function parseCommands(value: unknown): ModuleCommandContribution[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ModuleManifestError("entrypoint.commands must contain at least one command.");
  }
  return value.map((item, index): ModuleCommandContribution => {
      const command = object(item, `entrypoint.commands[${index}]`);
      const capability = text(command.capability, "command.capability");
      if (!CAPABILITIES.has(capability as ModuleCapability)) {
        throw new ModuleManifestError(`Unsupported command capability: ${capability}.`);
      }
      const id = text(command.command, "command.command");
      if (!COMMAND_ID.test(id)) {
        throw new ModuleManifestError(`Invalid VS Code command id: ${id}.`);
      }
      return {
        capability: capability as ModuleCapability,
        command: id,
        title: text(command.title, "command.title"),
      };
  });
}

export function parseModuleManifest(value: unknown): GraphForgeModuleManifest {
  const raw = object(value, "module manifest");
  if (raw.format !== GRAPHFORGE_MODULE_FORMAT) {
    throw new ModuleManifestError(`format must be ${GRAPHFORGE_MODULE_FORMAT}.`);
  }
  const id = text(raw.id, "id").toLowerCase();
  if (!MODULE_ID.test(id)) {
    throw new ModuleManifestError(
      "id must contain only lowercase letters, numbers, dots, and hyphens.",
    );
  }
  const version = text(raw.version, "version");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new ModuleManifestError("version must be a semantic version.");
  }
  const homepageUrl = homepage(raw.homepage);
  return {
    format: GRAPHFORGE_MODULE_FORMAT,
    id,
    name: text(raw.name, "name"),
    version,
    publisher: text(raw.publisher, "publisher"),
    description: text(raw.description, "description"),
    capabilities: parseCapabilities(raw.capabilities),
    entrypoint: parseEntrypoint(raw.entrypoint),
    ...(homepageUrl ? { homepage: homepageUrl } : {}),
  };
}

export function moduleContextKey(manifest: GraphForgeModuleManifest): string {
  const shortId = manifest.id.startsWith("graphforge.")
    ? manifest.id.slice("graphforge.".length)
    : manifest.id;
  return `graphforge.module.${shortId}.enabled`;
}
