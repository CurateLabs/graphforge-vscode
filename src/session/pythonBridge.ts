import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import * as path from "node:path";
import * as readline from "node:readline";
import type { EngineBackend, RuntimeKind } from "./types";

/**
 * Spawn protocol version this extension speaks. Bump alongside
 * `python/graphforge_host.py` and document breaking changes in
 * `docs/engineering/ARCHITECTURE.md`.
 */
export const BRIDGE_PROTOCOL_VERSION = 1;

const REQUEST_TIMEOUT_MS = 30_000;

interface BridgeResponse {
  id: number;
  protocol_version: number;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: string;
  error_kind?: string;
  code?: string | null;
}

/** Raised when the bridge subprocess reports an engine-side failure. */
export class PythonBridgeError extends Error {
  readonly code?: string;
  readonly kind?: string;

  constructor(message: string, code?: string, kind?: string) {
    super(message);
    this.name = "PythonBridgeError";
    this.code = code;
    this.kind = kind;
  }
}

/**
 * Owns one long-lived `graphforge_host.py` subprocess for the lifetime of a
 * single open project, matching the Node binding's in-process `GraphForge`
 * object lifecycle. Requests are newline-delimited JSON on stdin; responses
 * are newline-delimited JSON on stdout, correlated by `id`.
 */
export class PythonBridge {
  private child: ChildProcessWithoutNullStreams | undefined;
  private rl: readline.Interface | undefined;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }
  >();
  private startupError: string | undefined;

  constructor(
    private readonly interpreterPath: string,
    private readonly hostScriptPath: string = path.resolve(
      __dirname,
      "..",
      "..",
      "python",
      "graphforge_host.py",
    ),
  ) {}

  private ensureStarted(): void {
    if (this.child) {
      return;
    }
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.interpreterPath, [this.hostScriptPath], {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: path.dirname(this.hostScriptPath),
      });
    } catch (err) {
      this.startupError = err instanceof Error ? err.message : String(err);
      throw new PythonBridgeError(
        `Failed to spawn Python bridge (${this.interpreterPath}): ${this.startupError}`,
      );
    }
    this.child = child;

    child.on("error", (err) => {
      this.startupError = err.message;
      this.rejectAllPending(new PythonBridgeError(`Python bridge process error: ${err.message}`));
    });
    child.on("exit", (code, signal) => {
      this.rejectAllPending(
        new PythonBridgeError(
          `Python bridge exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
        ),
      );
      this.child = undefined;
      this.rl = undefined;
    });

    this.rl = readline.createInterface({ input: child.stdout });
    this.rl.on("line", (line) => this.handleLine(line));
  }

  private rejectAllPending(err: Error): void {
    for (const [, waiter] of this.pending) {
      waiter.reject(err);
    }
    this.pending.clear();
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    let parsed: BridgeResponse;
    try {
      parsed = JSON.parse(trimmed) as BridgeResponse;
    } catch {
      // Non-protocol output (shouldn't happen — host script only writes
      // protocol JSON to stdout); ignore rather than crash the session.
      return;
    }
    const waiter = this.pending.get(parsed.id);
    if (!waiter) {
      return;
    }
    this.pending.delete(parsed.id);
    if (parsed.ok) {
      waiter.resolve(parsed.result ?? {});
    } else {
      waiter.reject(
        new PythonBridgeError(parsed.error ?? "Python bridge reported an error", parsed.code ?? undefined, parsed.error_kind),
      );
    }
  }

  request(op: string, fields: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    this.ensureStarted();
    const child = this.child;
    if (!child?.stdin.writable) {
      return Promise.reject(
        new PythonBridgeError(
          this.startupError
            ? `Python bridge unavailable: ${this.startupError}`
            : "Python bridge stdin is not writable.",
        ),
      );
    }

    const id = this.nextId++;
    const payload = JSON.stringify({ id, op, ...fields }) + "\n";

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new PythonBridgeError(`Python bridge request '${op}' timed out after ${REQUEST_TIMEOUT_MS}ms.`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });

      child.stdin.write(payload, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new PythonBridgeError(`Failed to write to Python bridge: ${err.message}`));
        }
      });
    });
  }

  async dispose(): Promise<void> {
    if (!this.child) {
      return;
    }
    try {
      await this.request("close");
    } catch {
      // Best-effort; fall through to hard-kill below regardless.
    }
    this.rl?.close();
    this.child.kill();
    this.child = undefined;
  }
}

function arrowBuffer(result: Record<string, unknown>): Buffer {
  const b64 = result["arrow_ipc_base64"];
  if (typeof b64 !== "string") {
    throw new PythonBridgeError(
      `Python bridge returned no Arrow payload (got: ${Object.keys(result).join(", ") || "empty"}).`,
    );
  }
  return Buffer.from(b64, "base64");
}

/** Adapts a {@link PythonBridge} session to the runtime-agnostic {@link EngineBackend} contract. */
export class PythonEngineBackend implements EngineBackend {
  readonly runtime: RuntimeKind = "python";
  private resolvedPath: string | null = null;
  private resolvedOntologyMode = "unknown";

  private constructor(
    private readonly bridge: PythonBridge,
    rootPath: string,
  ) {
    this.resolvedPath = rootPath;
  }

  /**
   * `hostScriptPath` is exposed only so tests can point the bridge at a
   * lightweight fake host instead of `python/graphforge_host.py`; production
   * callers should omit it and get the packaged script.
   */
  static async open(
    interpreterPath: string,
    rootPath: string,
    hostScriptPath?: string,
  ): Promise<PythonEngineBackend> {
    const bridge = hostScriptPath
      ? new PythonBridge(interpreterPath, hostScriptPath)
      : new PythonBridge(interpreterPath);
    const backend = new PythonEngineBackend(bridge, rootPath);
    const result = await bridge.request("open", { path: rootPath });
    backend.resolvedPath = (result["path"] as string | undefined) ?? rootPath;
    backend.resolvedOntologyMode = (result["ontology_mode"] as string | undefined) ?? "unknown";
    return backend;
  }

  get path(): string | null {
    return this.resolvedPath;
  }

  async ontologyMode(): Promise<string> {
    try {
      const result = await this.bridge.request("ontology_mode");
      this.resolvedOntologyMode = (result["ontology_mode"] as string | undefined) ?? this.resolvedOntologyMode;
    } catch {
      // Keep last-known value; callers already treat ontologyMode failures as non-fatal.
    }
    return this.resolvedOntologyMode;
  }

  async execute(cypher: string, params?: Record<string, unknown>): Promise<Buffer> {
    const result = await this.bridge.request("execute", { cypher, params });
    return arrowBuffer(result);
  }

  async rank(
    label: string,
    by: string,
    via?: string | null,
    directed?: boolean | null,
  ): Promise<Buffer> {
    return this.verb("rank", { label, by, via, directed });
  }

  async cluster(
    label: string,
    by: string,
    via?: string | null,
    directed?: boolean | null,
  ): Promise<Buffer> {
    return this.verb("cluster", { label, by, via, directed });
  }

  async paths(
    source: unknown,
    target: unknown,
    by: string,
    via?: string | null,
    directed?: boolean | null,
    k?: number | null,
  ): Promise<Buffer> {
    return this.verb("paths", { source, target, by, via, directed, k });
  }

  async analyze(
    label: string | null | undefined,
    by: string,
    via?: string | null,
    directed?: boolean | null,
  ): Promise<Buffer> {
    return this.verb("analyze", { label, by, via, directed });
  }

  async similar(
    label: string,
    by: string,
    k?: number | null,
  ): Promise<Buffer> {
    return this.verb("similar", { label, by, k });
  }

  async find(
    query?: string | null,
    label?: string | null,
    limit?: number | null,
  ): Promise<Buffer> {
    return this.verb("find", { query, label, k: limit });
  }

  private async verb(name: string, args: Record<string, unknown>): Promise<Buffer> {
    const result = await this.bridge.request("verb", { verb: name, args });
    return arrowBuffer(result);
  }

  async labels(): Promise<string[]> {
    const result = await this.bridge.request("labels");
    return (result["labels"] as string[] | undefined) ?? [];
  }

  async relationshipTypes(): Promise<string[]> {
    const result = await this.bridge.request("relationship_types");
    return (result["relationship_types"] as string[] | undefined) ?? [];
  }

  async loadOntology(ontologyPath: string): Promise<void> {
    await this.bridge.request("load_ontology", { path: ontologyPath });
  }

  async listAssertions(): Promise<Buffer> {
    const result = await this.bridge.request("list_assertions");
    return arrowBuffer(result);
  }

  async dispose(): Promise<void> {
    await this.bridge.dispose();
  }
}
