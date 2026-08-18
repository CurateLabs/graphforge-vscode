import * as crypto from "node:crypto";

export type VisualizationKind = "graph" | "chart" | "temporal" | "geospatial" | "figure";
export type VisualizationLifecyclePhase = "prepare" | "layout" | "paint" | "ready" | "failed" | "disposed";

export interface VisualizationController {
  readonly instanceId: string;
  readonly kind: VisualizationKind;
  readonly coordinationGroup?: string;
  readonly renderGeneration: number;
  reveal(): void;
  dispose(): void;
}

export interface OwnedVisualizationResource {
  dispose(): void;
}

/** Revision, cancellation, and resource ownership shared by every panel kind. */
export class VisualizationInstanceLifecycle {
  private generation = 0;
  private currentWork: AbortController | undefined;
  private readonly resources = new Set<OwnedVisualizationResource>();
  private disposed = false;

  constructor(readonly instanceId: string) {}

  get renderGeneration(): number { return this.generation; }

  beginRender(): { context: VisualizationMessageContext; signal: AbortSignal } {
    if (this.disposed) throw new Error("Visualization instance is disposed.");
    this.currentWork?.abort();
    this.currentWork = new AbortController();
    this.generation++;
    return {
      context: { instanceId: this.instanceId, renderGeneration: this.generation },
      signal: this.currentWork.signal,
    };
  }

  accepts(context: Partial<VisualizationMessageContext>): boolean {
    return !this.disposed && context.instanceId === this.instanceId && context.renderGeneration === this.generation;
  }

  own<T extends OwnedVisualizationResource>(resource: T): T {
    if (this.disposed) {
      resource.dispose();
      return resource;
    }
    this.resources.add(resource);
    return resource;
  }

  release(resource: OwnedVisualizationResource): void { this.resources.delete(resource); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.currentWork?.abort();
    this.currentWork = undefined;
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
  }
}

export interface VisualizationMessageContext {
  instanceId: string;
  renderGeneration: number;
}

export interface VisualizationLifecycleDiagnostic extends VisualizationMessageContext {
  kind: VisualizationKind;
  phase: VisualizationLifecyclePhase;
  durationMs?: number;
  counts?: Readonly<Record<string, number>>;
  code?: string;
}

export interface VisualizationCoordinationEvent extends VisualizationMessageContext {
  group: string;
  sourceInstanceId: string;
  type: "selection" | "time" | "space";
  payload: unknown;
}

export function visualizationInstanceId(kind: VisualizationKind, projectRoot?: string, visualizationPath?: string): string {
  if (!projectRoot || !visualizationPath) return `${kind}:${crypto.randomUUID()}`;
  const digest = crypto.createHash("sha256").update(`${projectRoot}\0${visualizationPath}`).digest("hex").slice(0, 24);
  return `${kind}:${digest}`;
}

/** Process-local owner for live visualizations. Source values are never stored here. */
export class VisualizationInstanceRegistry {
  private readonly controllers = new Map<string, VisualizationController>();
  private readonly activationOrder: string[] = [];
  private readonly coordinationListeners = new Map<string, Set<(event: VisualizationCoordinationEvent) => void>>();

  register<T extends VisualizationController>(controller: T): T {
    if (this.controllers.has(controller.instanceId)) throw new Error(`Visualization instance is already registered: ${controller.instanceId}`);
    this.controllers.set(controller.instanceId, controller);
    this.touch(controller.instanceId);
    return controller;
  }
  get<T extends VisualizationController = VisualizationController>(instanceId: string): T | undefined { return this.controllers.get(instanceId) as T | undefined; }
  activate(instanceId: string): void { if (this.controllers.has(instanceId)) this.touch(instanceId); }
  active<T extends VisualizationController = VisualizationController>(kind?: VisualizationKind): T | undefined {
    for (let index = this.activationOrder.length - 1; index >= 0; index--) {
      const controller = this.controllers.get(this.activationOrder[index]);
      if (controller && (!kind || controller.kind === kind)) return controller as T;
    }
    return undefined;
  }
  coordinated<T extends VisualizationController = VisualizationController>(group: string): T[] {
    return [...this.controllers.values()].filter((controller) => controller.coordinationGroup === group) as T[];
  }
  subscribeCoordination(instanceId: string, listener: (event: VisualizationCoordinationEvent) => void): OwnedVisualizationResource {
    if (!this.controllers.has(instanceId)) throw new Error(`Unknown visualization instance: ${instanceId}`);
    const listeners = this.coordinationListeners.get(instanceId) ?? new Set();
    listeners.add(listener);
    this.coordinationListeners.set(instanceId, listeners);
    return { dispose: () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.coordinationListeners.delete(instanceId);
    } };
  }
  publishCoordination(event: VisualizationCoordinationEvent): void {
    const source = this.controllers.get(event.sourceInstanceId);
    if (!source || source.coordinationGroup !== event.group || source.renderGeneration !== event.renderGeneration) return;
    for (const target of this.coordinated(event.group)) {
      if (target.instanceId === event.sourceInstanceId) continue;
      for (const listener of this.coordinationListeners.get(target.instanceId) ?? []) listener(event);
    }
  }
  remove(instanceId: string): boolean {
    const removed = this.controllers.delete(instanceId);
    this.coordinationListeners.delete(instanceId);
    const index = this.activationOrder.indexOf(instanceId);
    if (index >= 0) this.activationOrder.splice(index, 1);
    return removed;
  }
  values<T extends VisualizationController = VisualizationController>(kind?: VisualizationKind): T[] {
    return [...this.controllers.values()].filter((controller) => !kind || controller.kind === kind) as T[];
  }
  dispose(): void {
    for (const controller of [...this.controllers.values()]) controller.dispose();
    this.controllers.clear();
    this.activationOrder.length = 0;
    this.coordinationListeners.clear();
  }
  private touch(instanceId: string): void {
    const previous = this.activationOrder.indexOf(instanceId);
    if (previous >= 0) this.activationOrder.splice(previous, 1);
    this.activationOrder.push(instanceId);
  }
}

export const visualizationInstances = new VisualizationInstanceRegistry();
