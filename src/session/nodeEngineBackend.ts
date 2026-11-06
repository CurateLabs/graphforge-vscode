import { bufferToUuid } from "./arrowCodec";
import type { EngineBackend, GraphForgeNative, RuntimeKind } from "./types";

/**
 * Adapts an in-process `@curatelabs/graphforge` instance to the runtime-agnostic
 * {@link EngineBackend} contract. All calls are synchronous under the hood
 * (N-API); wrapping them in resolved promises lets `GraphForgeSession` treat
 * Node and Python (#12) identically without branching on runtime.
 */
export class NodeEngineBackend implements EngineBackend {
  readonly runtime: RuntimeKind = "node";
  private readonly generations = new WeakMap<Buffer, string>();

  resultGeneration(ipc: Buffer): string | undefined {
    return this.generations.get(ipc);
  }

  private captureResult(ipc: Buffer): Buffer {
    const identity = this.forge.committedGenerationIdentity?.();
    const generation = identity && bufferToUuid(identity.generationUuid);
    if (generation) this.generations.set(ipc, generation);
    return ipc;
  }

  constructor(private readonly forge: GraphForgeNative) {}

  /**
   * Escape hatch to the full `@curatelabs/graphforge` surface for Node-only
   * advanced features (checkpoints, embedding spaces, indexing, invocation
   * descriptors, composite transactions, knowledge-ledger writes) that are
   * deliberately out of scope for the runtime-agnostic {@link EngineBackend}
   * facade (#12). Callers should check `runtime === "node"` (or narrow via
   * `instanceof NodeEngineBackend`) before reaching for this.
   */
  get native(): GraphForgeNative {
    return this.forge;
  }

  get path(): string | null {
    return this.forge.path;
  }

  async ontologyMode(): Promise<string> {
    return this.forge.ontologyMode;
  }

  async execute(cypher: string, params?: Record<string, unknown>): Promise<Buffer> {
    return this.captureResult(params ? this.forge.execute(cypher, params) : this.forge.execute(cypher));
  }

  async moduleCatalog(): Promise<unknown[]> {
    return this.forge.moduleCatalog?.() ?? [];
  }

  async rank(
    label: string,
    by: string,
    via?: string | null,
    directed?: boolean | null,
    writeProperty?: string | null,
  ): Promise<Buffer> {
    return this.captureResult(this.forge.rank(label, by, via, directed, writeProperty));
  }

  async cluster(
    label: string,
    by: string,
    via?: string | null,
    directed?: boolean | null,
    writeProperty?: string | null,
    vectorProperty?: string | null,
  ): Promise<Buffer> {
    return this.captureResult(this.forge.cluster(label, by, via, directed, writeProperty, vectorProperty));
  }

  async paths(
    source: unknown,
    target: unknown,
    by: string,
    via?: string | null,
    directed?: boolean | null,
    k?: number | null,
  ): Promise<Buffer> {
    return this.captureResult(this.forge.paths(source, target, by, via, directed, k));
  }

  async analyze(
    label: string | null | undefined,
    by: string,
    via?: string | null,
    directed?: boolean | null,
  ): Promise<Buffer> {
    return this.captureResult(this.forge.analyze(label, by, via, directed));
  }

  async similar(
    label: string,
    by: string,
    k?: number | null,
    vectorProperty?: string | null,
    via?: string | null,
  ): Promise<Buffer> {
    return this.captureResult(this.forge.similar(label, by, k, vectorProperty, via));
  }

  async find(
    query?: string | null,
    label?: string | null,
    limit?: number | null,
  ): Promise<Buffer> {
    // Native find() also carries vector/similarTo/semanticQuery/space/forceStale
    // (search parity, #8) — out of scope for the #12 facade; pass positionally.
    return this.captureResult(this.forge.find(query, label, undefined, undefined, undefined, limit));
  }

  async labels(): Promise<string[]> {
    return this.forge.labels();
  }

  async relationshipTypes(): Promise<string[]> {
    return this.forge.relationshipTypes();
  }

  async loadOntology(path: string): Promise<void> {
    this.forge.loadOntology(path);
  }

  async listAssertions(request?: unknown): Promise<Buffer> {
    if (!this.forge.listAssertions) {
      throw new Error("listAssertions not implemented by this @curatelabs/graphforge build");
    }
    return this.forge.listAssertions(request);
  }

  async dispose(): Promise<void> {
    this.forge.close?.();
  }
}
