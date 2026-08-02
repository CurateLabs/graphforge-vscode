import * as fs from "node:fs";
import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import type { ResultTableViewProvider } from "../views/resultTableView";
import {
  moduleContextKey,
  parseModuleManifest,
  type GraphForgeModuleManifest,
  type InstalledModuleRecord,
  type ModuleSource,
} from "./moduleManifest";
import type { ModuleViewModel } from "./moduleProtocol";
import {
  DANGEROUS_WORKSPACE_JS_SETTING,
  resolveWorkspaceScriptPath,
  workspaceScriptPolicyError,
} from "./workspaceScript";

const INSTALLS_KEY = "graphforge.modules.installed.v1";

export interface ModuleHost {
  readonly apiVersion: 1;
  readonly extensionUri: vscode.Uri;
  readonly session: GraphForgeSession;
  readonly results: ResultTableViewProvider;
  executeCommand<T = unknown>(command: string, ...args: unknown[]): Thenable<T | undefined>;
}

type GraphForgeModuleActivator = (
  context: vscode.ExtensionContext,
  host: ModuleHost,
) => void | vscode.Disposable | Promise<void | vscode.Disposable>;

export interface ModuleRegistration {
  manifest: GraphForgeModuleManifest | unknown;
  activate?: GraphForgeModuleActivator;
}

interface AvailableModule {
  manifest: GraphForgeModuleManifest;
  source: ModuleSource;
  activate?: GraphForgeModuleActivator;
}

interface ActiveModule {
  dispose(): void;
}

function now(): string {
  return new Date().toISOString();
}

function installedRecord(value: unknown): InstalledModuleRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<InstalledModuleRecord>;
  try {
    const manifest = parseModuleManifest(raw.manifest);
    if (!raw.source || typeof raw.source !== "object") return undefined;
    if (typeof raw.enabled !== "boolean" || typeof raw.installedAt !== "string") {
      return undefined;
    }
    return {
      manifest,
      source: raw.source as ModuleSource,
      enabled: raw.enabled,
      installedAt: raw.installedAt,
    };
  } catch {
    return undefined;
  }
}

/**
 * One lifecycle for default, GraphForge-catalog, and side-loaded modules. A
 * module owns a scoped subscription bag, so disabling it really
 * removes its commands/listeners without reloading the extension host.
 */
export class ModuleManager implements vscode.Disposable {
  private readonly available = new Map<string, AvailableModule>();
  private readonly installed = new Map<string, InstalledModuleRecord>();
  private readonly active = new Map<string, ActiveModule>();
  private readonly errors = new Map<string, string>();
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly configurationDisposable: vscode.Disposable;

  readonly onDidChange = this.changed.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly session: GraphForgeSession,
    private readonly results: ResultTableViewProvider,
  ) {
    for (const value of context.globalState.get<unknown[]>(INSTALLS_KEY, [])) {
      const record = installedRecord(value);
      if (record) this.installed.set(record.manifest.id, record);
    }
    this.configurationDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration(
          `graphforge.${DANGEROUS_WORKSPACE_JS_SETTING}`,
        )
      ) {
        void this.enforceWorkspaceScriptSetting();
      }
    });
  }

  async initialize(firstParty: ModuleRegistration[]): Promise<void> {
    for (const registration of firstParty) {
      const manifest = parseModuleManifest(registration.manifest);
      this.available.set(manifest.id, {
        manifest,
        source: { kind: "first-party" },
        activate: registration.activate,
      });
      const existing = this.installed.get(manifest.id);
      this.installed.set(manifest.id, {
        manifest,
        source: { kind: "first-party" },
        enabled: existing?.enabled ?? true,
        installedAt: existing?.installedAt ?? now(),
      });
    }
    await this.persist();
    await this.enforceWorkspaceScriptSetting();
    for (const record of this.installed.values()) {
      await this.setContext(record.manifest, record.enabled);
      if (
        record.enabled &&
        (this.available.has(record.manifest.id) ||
          record.manifest.entrypoint.kind === "commands")
      ) {
        await this.activate(record.manifest.id);
      }
    }
    this.changed.fire();
  }

  async refreshGraphForgeCatalog(): Promise<void> {
    for (const [id, item] of this.available) {
      if (item.source.kind === "graphforge") {
        this.deactivate(id);
        this.available.delete(id);
        this.errors.delete(id);
      }
    }
    if (this.session.project) {
      const manifests = await this.session.graphForgeModuleCatalog();
      for (const value of manifests) {
        const manifest = parseModuleManifest(value);
        if (manifest.entrypoint.kind !== "graphforge") {
          throw new Error(
            `GraphForge catalog module ${manifest.id} must use a graphforge entrypoint.`,
          );
        }
        this.available.set(manifest.id, {
          manifest,
          source: {
            kind: "graphforge",
            capabilityId: manifest.entrypoint.capabilityId,
          },
        });
        if (this.installed.get(manifest.id)?.enabled) await this.activate(manifest.id);
      }
    }
    this.changed.fire();
  }

  async install(id: string): Promise<void> {
    const available = this.available.get(id);
    if (!available) throw new Error(`Module ${id} is not available.`);
    this.installed.set(id, {
      manifest: available.manifest,
      source: available.source,
      enabled: true,
      installedAt: now(),
    });
    await this.persist();
    await this.setContext(available.manifest, true);
    await this.activate(id);
    this.changed.fire();
  }

  async installFromUri(uri: vscode.Uri): Promise<boolean> {
    const stat = await fs.promises.stat(uri.fsPath);
    const manifestPath = stat.isDirectory()
      ? vscode.Uri.joinPath(uri, "graphforge-module.json").fsPath
      : uri.fsPath;
    const raw = JSON.parse(await fs.promises.readFile(manifestPath, "utf8")) as unknown;
    const manifest = parseModuleManifest(raw);
    if (manifest.id.startsWith("graphforge.")) {
      throw new Error("The graphforge.* module namespace is reserved for GraphForge.");
    }
    if (
      manifest.entrypoint.kind === "builtin" ||
      manifest.entrypoint.kind === "graphforge"
    ) {
      throw new Error(
        "Side-loaded modules cannot use builtin or GraphForge-owned entrypoints.",
      );
    }
    if (manifest.entrypoint.kind === "workspace-script") {
      this.assertWorkspaceScriptAllowed();
      const scriptPath = await resolveWorkspaceScriptPath(
        manifestPath,
        manifest.entrypoint.script,
      );
      const choice = await vscode.window.showWarningMessage(
        `Run side-loaded module code from ${scriptPath}?`,
        {
          modal: true,
          detail:
            "This code runs with the same permissions as the GraphForge extension and can read or change local files. Only continue if you trust its author and contents.",
        },
        "Install and run code",
      );
      if (choice !== "Install and run code") return false;
    }
    const available: AvailableModule = {
      manifest,
      source: { kind: "sideload", manifestPath },
    };
    this.available.set(manifest.id, available);
    await this.install(manifest.id);
    return true;
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const record = this.installed.get(id);
    if (!record) throw new Error(`Module ${id} is not installed.`);
    record.enabled = enabled;
    this.errors.delete(id);
    if (enabled) {
      await this.setContext(record.manifest, true);
      await this.activate(id);
    } else {
      this.deactivate(id);
      await this.setContext(record.manifest, false);
    }
    await this.persist();
    this.changed.fire();
  }

  async activatePending(): Promise<void> {
    for (const record of this.installed.values()) {
      if (record.enabled && !this.active.has(record.manifest.id)) {
        await this.activate(record.manifest.id);
      }
    }
    this.changed.fire();
  }

  async remove(id: string): Promise<void> {
    const record = this.installed.get(id);
    if (!record) return;
    if (record.source.kind === "first-party") {
      throw new Error("First-party modules can be disabled but not removed.");
    }
    this.deactivate(id);
    this.installed.delete(id);
    this.errors.delete(id);
    await this.setContext(record.manifest, false);
    await this.persist();
    this.changed.fire();
  }

  list(): ModuleViewModel[] {
    const ids = new Set([...this.available.keys(), ...this.installed.keys()]);
    return [...ids]
      .map((id): ModuleViewModel => {
        const record = this.installed.get(id);
        const available = this.available.get(id);
        const manifest = available?.manifest ?? record!.manifest;
        const error = this.errors.get(id);
        const installed = Boolean(record);
        const enabled = record?.enabled ?? false;
        const actions =
          manifest.entrypoint.kind === "commands" ||
          manifest.entrypoint.kind === "graphforge"
            ? (manifest.entrypoint.commands ?? []).map(({ title, command }) => ({
                title,
                command,
              }))
            : [];
        return {
          id,
          name: manifest.name,
          version: manifest.version,
          publisher: manifest.publisher,
          description: manifest.description,
          capabilities: manifest.capabilities,
          source: record?.source.kind ?? available!.source.kind,
          installed,
          enabled,
          available:
            Boolean(available) ||
            manifest.entrypoint.kind === "commands",
          removable: record?.source.kind !== "first-party",
          status: error
            ? "error"
            : !installed
              ? "available"
              : !enabled
                ? "disabled"
                : this.active.has(id) || manifest.entrypoint.kind === "commands"
                  ? "active"
                  : "unavailable",
          ...(error ? { error } : {}),
          actions,
          ...(manifest.homepage ? { homepage: manifest.homepage } : {}),
        };
      })
      .sort((a, b) => {
        if (a.source === "first-party" && b.source !== "first-party") return -1;
        if (b.source === "first-party" && a.source !== "first-party") return 1;
        return a.name.localeCompare(b.name);
      });
  }

  dispose(): void {
    for (const id of [...this.active.keys()]) this.deactivate(id);
    this.configurationDisposable.dispose();
    this.changed.dispose();
  }

  private async activate(id: string): Promise<void> {
    if (this.active.has(id)) return;
    const record = this.installed.get(id);
    if (!record?.enabled) return;
    let available = this.available.get(id);
    try {
      if (record.manifest.entrypoint.kind === "workspace-script") {
        this.assertWorkspaceScriptAllowed();
        available = {
          manifest: record.manifest,
          source: record.source,
          activate: async (context, host) => {
            if (record.source.kind !== "sideload") {
              throw new Error("Workspace-script modules must be side-loaded.");
            }
            const scriptPath = await resolveWorkspaceScriptPath(
              record.source.manifestPath,
              record.manifest.entrypoint.kind === "workspace-script"
                ? record.manifest.entrypoint.script
                : "",
            );
            const resolved = require.resolve(scriptPath);
            delete require.cache[resolved];
            const loaded = require(resolved) as unknown;
            const candidate =
              typeof loaded === "function"
                ? loaded
                : loaded && typeof loaded === "object"
                  ? (loaded as {
                      activate?: unknown;
                      default?: unknown | { activate?: unknown };
                    }).activate ??
                    (typeof (loaded as { default?: unknown }).default === "function"
                      ? (loaded as { default: unknown }).default
                      : (loaded as { default?: { activate?: unknown } }).default
                          ?.activate)
                  : undefined;
            if (typeof candidate !== "function") {
              throw new Error(
                "Workspace script must export an activate(context, host) function.",
              );
            }
            return (candidate as GraphForgeModuleActivator)(context, host);
          },
        };
      }
      if (
        !available &&
        record.manifest.entrypoint.kind !== "commands"
      ) {
        throw new Error("The module provider is not available in this extension host.");
      }

      const subscriptions: vscode.Disposable[] = [];
      const scopedContext = Object.create(this.context) as vscode.ExtensionContext;
      Object.defineProperty(scopedContext, "subscriptions", {
        configurable: false,
        enumerable: true,
        value: subscriptions,
        writable: false,
      });
      if (available?.activate) {
        const returned = await available.activate(scopedContext, this.host());
        if (returned) subscriptions.push(returned);
      }
      this.active.set(id, {
        dispose: () => {
          for (const disposable of subscriptions.splice(0).reverse()) {
            disposable.dispose();
          }
        },
      });
      this.errors.delete(id);
    } catch (error) {
      this.errors.set(id, error instanceof Error ? error.message : String(error));
      await this.setContext(record.manifest, false);
    }
  }

  private deactivate(id: string): void {
    this.active.get(id)?.dispose();
    this.active.delete(id);
  }

  private host(): ModuleHost {
    return {
      apiVersion: 1,
      extensionUri: this.context.extensionUri,
      session: this.session,
      results: this.results,
      executeCommand: (command, ...args) =>
        vscode.commands.executeCommand(command, ...args),
    };
  }

  private async setContext(
    manifest: GraphForgeModuleManifest,
    enabled: boolean,
  ): Promise<void> {
    await vscode.commands.executeCommand("setContext", moduleContextKey(manifest), enabled);
  }

  private assertWorkspaceScriptAllowed(): void {
    const inspected = vscode.workspace
      .getConfiguration("graphforge")
      .inspect<boolean>(DANGEROUS_WORKSPACE_JS_SETTING);
    const error = workspaceScriptPolicyError(
      inspected?.globalValue,
      vscode.workspace.isTrusted,
    );
    if (error) throw new Error(error);
  }

  private async enforceWorkspaceScriptSetting(): Promise<void> {
    let allowed = true;
    try {
      this.assertWorkspaceScriptAllowed();
    } catch {
      allowed = false;
    }
    if (allowed) return;

    let changed = false;
    for (const record of this.installed.values()) {
      if (record.manifest.entrypoint.kind !== "workspace-script" || !record.enabled) {
        continue;
      }
      record.enabled = false;
      this.deactivate(record.manifest.id);
      await this.setContext(record.manifest, false);
      changed = true;
    }
    if (changed) {
      await this.persist();
      this.changed.fire();
    }
  }

  private async persist(): Promise<void> {
    await this.context.globalState.update(INSTALLS_KEY, [...this.installed.values()]);
  }
}
