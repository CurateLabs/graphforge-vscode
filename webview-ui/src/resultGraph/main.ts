import cytoscape, { type Core, type LayoutOptions } from "cytoscape";
import {
  EdgeEvent,
  Graph as G6Graph,
  NodeEvent,
  type ElementDatum,
  type GraphOptions,
} from "@antv/g6";
import Graphology from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Sigma from "sigma";
import { EdgeArrowProgram, EdgeRectangleProgram } from "sigma/rendering";
import type { GraphPayload } from "../../../src/session/types";
import {
  CLASS_COLOR_PALETTE,
  type HostToWebview,
  type ResultGraphRenderPhase,
  type WebviewToHost,
} from "../../../src/webview/protocol";
import {
  classColor,
  classOf,
  edgeLabel,
  graphItemColor,
  nodeLabel,
  resolveResultGraphCytoscapeOptions,
  resolveResultGraphG6Options,
  resolveResultGraphSigmaOptions,
  type EnabledResultGraphTimebarOptions,
  type ResultGraphRenderer,
  type ResultGraphViewOptions,
} from "../../../src/webview/resultGraphModel";
import { scheduleInitialResultGraphLayout } from "../../../src/webview/resultGraphLayout";
import type {
  ResultGraphLayoutWorkerRequest,
  ResultGraphLayoutWorkerResponse,
} from "./layout.worker";
import InlineLayoutWorker from "./layout.worker?worker&inline";
import "./resultGraph.css";

interface RendererHandle {
  destroy(): void;
  fit(): void;
  relayout(): void;
  highlight(nodeIds: string[], edgeIds: string[]): void;
}

const vscode = acquireVsCodeApi();
const graphElement = document.getElementById("graph");
const emptyElement = document.getElementById("empty");
const titleElement = document.getElementById("title");
const rendererLabel = document.getElementById("renderer-label");
const statusLegend = document.getElementById("status-legend");
const typeLegend = document.getElementById("type-legend");
const banner = document.getElementById("banner");
const footer = document.getElementById("footer");
const fitButton = document.getElementById("fit") as HTMLButtonElement | null;
const relayoutButton = document.getElementById("relayout") as HTMLButtonElement | null;
const saveArtifactButton = document.getElementById("save-artifact") as HTMLButtonElement | null;
const revertArtifactButton = document.getElementById("revert-artifact") as HTMLButtonElement | null;

let payload: GraphPayload | undefined;
let rendererKind: ResultGraphRenderer = "g6";
let viewOptions: Omit<ResultGraphViewOptions, "renderer"> = {};
let renderer: RendererHandle | undefined;
let runtimeBanner: string | undefined;

function post(message: WebviewToHost): void {
  vscode.postMessage(message);
}

function shiftKeyFromPointerPayload(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const event = value as Record<string, unknown>;
  if (event.shiftKey === true) {
    return true;
  }
  for (const key of ["originalEvent", "event", "original"]) {
    const nested = event[key];
    if (
      nested &&
      typeof nested === "object" &&
      (nested as Record<string, unknown>).shiftKey === true
    ) {
      return true;
    }
    if (nested && typeof nested === "object") {
      const original = (nested as Record<string, unknown>).original;
      if (
        original &&
        typeof original === "object" &&
        (original as Record<string, unknown>).shiftKey === true
      ) {
        return true;
      }
    }
  }
  return false;
}

function themeValue(name: string, fallback: string): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
}

function setEmpty(message: string | undefined): void {
  if (!emptyElement) {
    return;
  }
  emptyElement.hidden = !message;
  emptyElement.textContent = message ?? "";
}

function showBanner(): void {
  if (!banner) {
    return;
  }
  const messages = [payload?.banner, runtimeBanner].filter(Boolean);
  banner.textContent = messages.join(" ");
  banner.hidden = messages.length === 0;
}

function appendLegendItem(
  root: HTMLElement,
  label: string,
  colorClass: string,
  outlined = false,
): void {
  const item = document.createElement("span");
  item.className = "swatch";
  const dot = document.createElement("span");
  dot.className = `dot ${colorClass}${outlined ? " outline" : ""}`;
  dot.setAttribute("aria-hidden", "true");
  item.append(dot, document.createTextNode(label));
  root.append(item);
}

function renderLegend(current: GraphPayload): void {
  if (!statusLegend || !typeLegend) {
    return;
  }
  statusLegend.replaceChildren();
  typeLegend.replaceChildren();
  const epistemic = current.styleMode === "epistemic" || current.styleMode === "demo";
  if (epistemic) {
    for (const status of current.legend.statuses) {
      appendLegendItem(statusLegend, status, `color-${status}`);
    }
  }
  for (const type of current.legend.types) {
    const paletteIndex = CLASS_COLOR_PALETTE.indexOf(classColor(type));
    appendLegendItem(
      typeLegend,
      `class: ${type}`,
      paletteIndex >= 0 ? `palette-${paletteIndex}` : "",
      epistemic,
    );
  }
}

function renderChrome(current: GraphPayload): void {
  if (titleElement) {
    titleElement.textContent = current.title || "Result Graph";
  }
  if (rendererLabel) {
    rendererLabel.textContent =
      rendererKind === "g6"
        ? "AntV G6 · Canvas"
        : rendererKind === "cytoscape"
          ? "Cytoscape renderer"
          : "Sigma renderer";
  }
  renderLegend(current);
  showBanner();
  const styleLabel =
    current.styleMode === "epistemic"
      ? "epistemic styling"
      : current.styleMode === "demo"
        ? "demo styling"
        : "class-only styling";
  if (footer) {
    footer.textContent = `${current.nodes.length} nodes · ${current.edges.length} edges · ${styleLabel}`;
  }
}

function initialPosition(index: number, count: number): { x: number; y: number } {
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  const radius = Math.sqrt((index + 0.5) / Math.max(count, 1)) * 100;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

function cytoscapeLayout(cy: Core, fit: boolean): void {
  const resolved = resolveResultGraphCytoscapeOptions(
    viewOptions,
    cy.nodes().length,
    cy.edges().length,
  );
  const options: LayoutOptions = {
    name: "cose",
    animate: false,
    randomize: false,
    fit,
    padding: 36,
    nodeRepulsion: () => resolved.layout.nodeRepulsion,
    idealEdgeLength: () => resolved.layout.idealEdgeLength,
    edgeElasticity: () => 100,
    gravity: resolved.layout.gravity,
    numIter: resolved.layout.maxIterations,
  };
  cy.layout(options).run();
}

function createCytoscape(current: GraphPayload): RendererHandle {
  if (!graphElement) {
    throw new Error("Graph container missing");
  }
  const foreground = themeValue("--vscode-editor-foreground", "#cccccc");
  const muted = themeValue("--vscode-descriptionForeground", "#8c8c8c");
  const knownNodes = new Set(current.nodes.map((node) => node.id));
  const resolved = resolveResultGraphCytoscapeOptions(
    viewOptions,
    current.nodes.length,
    current.edges.length,
  );
  const density = resolved.visualDensity;
  const cy = cytoscape({
    container: graphElement,
    elements: [
      ...current.nodes.map((node, index) => ({
        group: "nodes" as const,
        data: {
          id: node.id,
          label: density.showNodeLabels
            ? nodeLabel(node, viewOptions.labels).slice(0, 32)
            : "",
          classLabel: classOf(node).slice(0, 14),
          color: graphItemColor(node, current),
        },
        position: initialPosition(index, current.nodes.length),
      })),
      ...current.edges
        .filter((edge) => knownNodes.has(edge.source) && knownNodes.has(edge.target))
        .map((edge) => ({
          group: "edges" as const,
          data: {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            label: density.showEdgeLabels
              ? edgeLabel(edge, viewOptions.labels)
              : "",
            color: graphItemColor(edge, current),
          },
        })),
    ],
    style: [
      {
        selector: "node",
        style: {
          "background-color": "data(color)",
          "border-color": foreground,
          "border-width": 1,
          label: "data(label)",
          color: foreground,
          "font-size": 10,
          "text-valign": "bottom",
          "text-margin-y": 7,
          "text-outline-color": themeValue("--vscode-editor-background", "#1e1e1e"),
          "text-outline-width": 2,
          width: density.nodeSize,
          height: density.nodeSize,
        },
      },
      {
        selector: "edge",
        style: {
          width: density.edgeWidth,
          "line-color":
            current.styleMode === "class-only" ? muted : "data(color)",
          "target-arrow-color":
            current.styleMode === "class-only" ? muted : "data(color)",
          "target-arrow-shape": density.arrowheads ? "triangle" : "none",
          "curve-style": "bezier",
          label: "data(label)",
          color: muted,
          "font-size": 8,
          "text-background-color": themeValue("--vscode-editor-background", "#1e1e1e"),
          "text-background-opacity": 0.8,
          "text-background-padding": "2px",
        },
      },
      {
        selector: ":selected",
        style: {
          "border-color": themeValue("--vscode-focusBorder", "#4c6ef5"),
          "border-width": 3,
          "overlay-opacity": 0.12,
          "overlay-color": themeValue("--vscode-focusBorder", "#4c6ef5"),
        },
      },
      {
        selector: "edge:selected",
        style: {
          width: 4,
          "line-color": themeValue("--vscode-focusBorder", "#4c6ef5"),
          "target-arrow-color": themeValue("--vscode-focusBorder", "#4c6ef5"),
        },
      },
    ],
    minZoom: 0.03,
    maxZoom: 8,
    wheelSensitivity: 0.18,
    layout: { name: "preset" },
  });

  cy.on("tap", "node", (event) => {
    post({
      type: "graphforge/selectNode",
      id: event.target.id(),
      shiftKey: shiftKeyFromPointerPayload(event),
    });
  });
  cy.on("tap", "edge", (event) => {
    post({
      type: "graphforge/selectEdge",
      id: event.target.id(),
      shiftKey: shiftKeyFromPointerPayload(event),
    });
  });

  return {
    destroy: () => cy.destroy(),
    fit: () => cy.fit(undefined, 36),
    relayout: () => cytoscapeLayout(cy, true),
    highlight: (nodeIds, edgeIds) => {
      const ids = new Set([...nodeIds, ...edgeIds]);
      const selected = cy.elements().filter((element) => ids.has(element.id()));
      cy.elements().unselect();
      selected.select();
      if (selected.length > 0) {
        cy.animate({
          fit: { eles: selected, padding: 80 },
          duration: 220,
        });
      }
    },
  };
}

function createSigma(current: GraphPayload): RendererHandle {
  if (!graphElement) {
    throw new Error("Graph container missing");
  }
  const graph = new Graphology({
    multi: true,
    type: "directed",
    allowSelfLoops: true,
  });
  const resolved = resolveResultGraphSigmaOptions(
    viewOptions,
    current.nodes.length,
    current.edges.length,
  );
  const density = resolved.visualDensity;
  for (const [index, node] of current.nodes.entries()) {
    graph.addNode(node.id, {
      ...initialPosition(index, current.nodes.length),
      size: density.nodeSize,
      color: graphItemColor(node, current),
      label: density.showNodeLabels
        ? nodeLabel(node, viewOptions.labels).slice(0, 40)
        : "",
    });
  }
  const edgeKeys = new Set<string>();
  for (const [index, edge] of current.edges.entries()) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) {
      continue;
    }
    let key = edge.id || `edge-${index}`;
    while (edgeKeys.has(key)) {
      key = `${edge.id || "edge"}-${index}`;
    }
    edgeKeys.add(key);
    const color =
      current.styleMode === "class-only"
        ? themeValue("--vscode-descriptionForeground", "#8c8c8c")
        : graphItemColor(edge, current);
    graph.addDirectedEdgeWithKey(key, edge.source, edge.target, {
      payloadId: edge.id,
      size: density.edgeWidth,
      color,
      baseColor: color,
      label: density.showEdgeLabels
        ? edgeLabel(edge, viewOptions.labels)
        : "",
    });
  }

  const artifact = viewOptions.source === "artifact-v2";
  const sigma = new Sigma(graph, graphElement, {
    enableEdgeEvents: true,
    renderLabels: density.showNodeLabels,
    renderEdgeLabels: density.showEdgeLabels,
    edgeProgramClasses: {
      arrow: EdgeArrowProgram,
      rectangle: EdgeRectangleProgram,
    },
    defaultEdgeType: density.arrowheads ? "arrow" : "rectangle",
    labelColor: { color: themeValue("--vscode-editor-foreground", "#cccccc") },
    labelDensity: artifact ? 1 : current.nodes.length > 400 ? 0.25 : 1,
    ...(artifact ? { labelRenderedSizeThreshold: 0 } : {}),
    minCameraRatio: 0.02,
    maxCameraRatio: 12,
  });
  sigma.on("clickNode", (event) => {
    post({
      type: "graphforge/selectNode",
      id: event.node,
      shiftKey: shiftKeyFromPointerPayload(event),
    });
  });
  sigma.on("clickEdge", (event) => {
    const id = graph.getEdgeAttribute(event.edge, "payloadId");
    if (typeof id === "string") {
      post({
        type: "graphforge/selectEdge",
        id,
        shiftKey: shiftKeyFromPointerPayload(event),
      });
    }
  });

  return {
    destroy: () => sigma.kill(),
    fit: () => {
      void sigma.getCamera().animatedReset({ duration: 180 });
    },
    relayout: () => {
      forceAtlas2.assign(graph, {
        iterations: resolved.layout.iterations,
        settings: {
          ...forceAtlas2.inferSettings(graph),
          barnesHutOptimize: resolved.layout.barnesHutOptimize,
          gravity: resolved.layout.gravity,
          slowDown: resolved.layout.slowDown,
        },
      });
      sigma.refresh();
      void sigma.getCamera().animatedReset({ duration: 180 });
    },
    highlight: (nodeIds, edgeIds) => {
      const selectedNodes = new Set(nodeIds);
      const selectedEdges = new Set(edgeIds);
      graph.forEachNode((node) => {
        graph.setNodeAttribute(node, "highlighted", selectedNodes.has(node));
        graph.setNodeAttribute(
          node,
          "size",
          selectedNodes.has(node)
            ? density.nodeSize * 1.8
            : density.nodeSize,
        );
      });
      graph.forEachEdge((edge) => {
        graph.setEdgeAttribute(
          edge,
          "size",
          selectedEdges.has(edge)
            ? 4
            : density.edgeWidth,
        );
        graph.setEdgeAttribute(
          edge,
          "color",
          selectedEdges.has(edge)
            ? themeValue("--vscode-focusBorder", "#4c6ef5")
            : graph.getEdgeAttribute(edge, "baseColor"),
        );
      });
      sigma.refresh();
    },
  };
}

class ResultGraphRuntimeError extends Error {
  constructor(
    readonly phase: ResultGraphRenderPhase,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ResultGraphRuntimeError";
  }
}

class ResultGraphLayoutCancelled extends Error {
  constructor() {
    super("The superseded G6 layout was cancelled.");
    this.name = "ResultGraphLayoutCancelled";
  }
}

interface G6LayoutTask {
  promise: Promise<ResultGraphLayoutWorkerResponse & { ok: true }>;
  cancel(): void;
}

function startG6Layout(request: ResultGraphLayoutWorkerRequest): G6LayoutTask {
  const worker = new InlineLayoutWorker({ type: "module" });
  let settled = false;
  let rejectTask: (error: Error) => void = () => undefined;
  const promise = new Promise<ResultGraphLayoutWorkerResponse & { ok: true }>(
    (resolve, reject) => {
      rejectTask = reject;
      worker.onmessage = (
        event: MessageEvent<ResultGraphLayoutWorkerResponse>,
      ) => {
        if (settled) return;
        settled = true;
        worker.terminate();
        if (event.data.ok) {
          resolve(event.data);
        } else {
          reject(
            new ResultGraphRuntimeError(
              "layout",
              event.data.code,
              event.data.message,
            ),
          );
        }
      };
      worker.onerror = () => {
        if (settled) return;
        settled = true;
        worker.terminate();
        reject(
          new ResultGraphRuntimeError(
            "layout",
            "GF_G6_LAYOUT_WORKER_FAILED",
            "The G6 layout worker could not start.",
          ),
        );
      };
      worker.postMessage(request);
    },
  );
  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      rejectTask(new ResultGraphLayoutCancelled());
    },
  };
}

function parseTimebarValue(
  raw: unknown,
  field: string,
  options: EnabledResultGraphTimebarOptions,
): number {
  if (options.format === "epoch-ms") {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }
    throw new ResultGraphRuntimeError(
      "initialize",
      "GF_G6_TIMEBAR_VALUE_INVALID",
      `Timebar field ${field} must contain finite epoch-millisecond numbers.`,
    );
  }
  if (
    typeof raw !== "string" ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)
  ) {
    throw new ResultGraphRuntimeError(
      "initialize",
      "GF_G6_TIMEBAR_VALUE_INVALID",
      `Timebar field ${field} must contain ISO-8601 timestamps with an explicit offset.`,
    );
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    throw new ResultGraphRuntimeError(
      "initialize",
      "GF_G6_TIMEBAR_VALUE_INVALID",
      `Timebar field ${field} contains an invalid ISO-8601 timestamp.`,
    );
  }
  return parsed;
}

function prepareTimebar(
  current: GraphPayload,
  renderedEdges: GraphPayload["edges"],
  options: EnabledResultGraphTimebarOptions | undefined,
): {
  nodeTimes: Map<string, number>;
  edgeTimes: Map<string, number>;
  data: number[];
} {
  const nodeTimes = new Map<string, number>();
  const edgeTimes = new Map<string, number>();
  if (!options) {
    return { nodeTimes, edgeTimes, data: [] };
  }
  if (
    options.elementTypes.length === 0 ||
    !options.values.every(Number.isFinite) ||
    options.values[0] > options.values[1]
  ) {
    throw new ResultGraphRuntimeError(
      "initialize",
      "GF_G6_TIMEBAR_OPTIONS_INVALID",
      "The saved Timebar configuration is incomplete or invalid.",
    );
  }
  if (options.elementTypes.includes("node")) {
    if (!options.nodeField) {
      throw new ResultGraphRuntimeError("initialize", "GF_G6_TIMEBAR_OPTIONS_INVALID", "Node Timebar filtering requires nodeField.");
    }
    for (const node of current.nodes) {
      nodeTimes.set(
        node.id,
        parseTimebarValue(node.properties[options.nodeField], options.nodeField, options),
      );
    }
  }
  if (options.elementTypes.includes("edge")) {
    if (!options.edgeField) {
      throw new ResultGraphRuntimeError("initialize", "GF_G6_TIMEBAR_OPTIONS_INVALID", "Edge Timebar filtering requires edgeField.");
    }
    for (const edge of renderedEdges) {
      edgeTimes.set(
        edge.id,
        parseTimebarValue(edge.properties?.[options.edgeField], options.edgeField, options),
      );
    }
  }
  return {
    nodeTimes,
    edgeTimes,
    data: [...new Set([...nodeTimes.values(), ...edgeTimes.values()])].sort(
      (left, right) => left - right,
    ),
  };
}

function createG6(current: GraphPayload): RendererHandle {
  if (!graphElement) {
    throw new ResultGraphRuntimeError(
      "initialize",
      "GF_G6_CONTAINER_MISSING",
      "Graph container missing.",
    );
  }

  const options = resolveResultGraphG6Options(viewOptions);
  if (options.backend !== "canvas") {
    throw new ResultGraphRuntimeError(
      "initialize",
      "GF_G6_BACKEND_UNSUPPORTED",
      `G6 backend ${String(options.backend)} is not installed.`,
    );
  }

  const foreground = themeValue("--vscode-editor-foreground", "#cccccc");
  const muted = themeValue("--vscode-descriptionForeground", "#8c8c8c");
  const focus = themeValue("--vscode-focusBorder", "#4c6ef5");
  const knownNodes = new Set(current.nodes.map((node) => node.id));
  const renderedEdges = current.edges.filter(
    (edge) => knownNodes.has(edge.source) && knownNodes.has(edge.target),
  );
  const temporal = prepareTimebar(current, renderedEdges, options.timebar);
  const plugins: GraphOptions["plugins"] = options.timebar
    ? [
        {
          type: "timebar",
          key: "graphforge-timebar",
          data: temporal.data,
          timebarType: "time",
          elementTypes: options.timebar.elementTypes,
          mode: "visibility",
          values: options.timebar.values,
          position: options.timebar.position,
          width: options.timebar.width,
          height: options.timebar.height,
          loop: options.timebar.loop,
          getTime: (datum: ElementDatum) => {
            const time = datum.data?.graphforgeTime;
            return typeof time === "number" ? time : Number.NaN;
          },
          onChange: (values: number | [number, number]) => {
            post({
              type: "graphforge/timebarChanged",
              values: Array.isArray(values) ? values : [values, values],
            });
          },
        },
      ]
    : [];
  const density = options.visualDensity;
  const g6 = new G6Graph({
    container: graphElement,
    data: {
      nodes: current.nodes.map((node, index) => ({
        id: node.id,
        data: { graphforgeTime: temporal.nodeTimes.get(node.id) },
        style: {
          ...initialPosition(index, current.nodes.length),
          size: density.nodeSize,
          fill: graphItemColor(node, current),
          stroke: foreground,
          lineWidth: 1,
          labelText: density.showNodeLabels
            ? nodeLabel(node, viewOptions.labels).slice(0, 40)
            : "",
          labelFill: foreground,
          labelFontSize: 10,
          labelOffsetY: 7,
          labelBackground: false,
        },
      })),
      edges: renderedEdges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        data: { graphforgeTime: temporal.edgeTimes.get(edge.id) },
        style: {
          stroke:
            current.styleMode === "class-only"
              ? muted
              : graphItemColor(edge, current),
          lineWidth: density.edgeWidth,
          endArrow: density.arrowheads,
          labelText: density.showEdgeLabels
            ? edgeLabel(edge, viewOptions.labels)
            : "",
          labelFill: muted,
          labelFontSize: 8,
          labelBackground: false,
        },
      })),
    },
    animation: false,
    padding: options.timebar
      ? [16, 16, options.timebar.height + 16, 16]
      : 16,
    zoomRange: [0.03, 8],
    behaviors: [
      "drag-canvas",
      "zoom-canvas",
      { type: "click-select", multiple: true, state: "selected" },
    ],
    plugins,
    node: {
      state: {
        selected: { stroke: focus, lineWidth: 4, halo: true },
        highlight: { stroke: focus, lineWidth: 4, halo: true },
      },
    },
    edge: {
      state: {
        selected: { stroke: focus, lineWidth: 4 },
        highlight: { stroke: focus, lineWidth: 4 },
      },
    },
  });

  g6.on(NodeEvent.CLICK, (event) => {
    const id = (event as unknown as { target: { id: string } }).target.id;
    post({
      type: "graphforge/selectNode",
      id,
      shiftKey: shiftKeyFromPointerPayload(event),
    });
  });
  g6.on(EdgeEvent.CLICK, (event) => {
    const id = (event as unknown as { target: { id: string } }).target.id;
    post({
      type: "graphforge/selectEdge",
      id,
      shiftKey: shiftKeyFromPointerPayload(event),
    });
  });

  let destroyed = false;
  let hasRendered = false;
  let activeLayout: G6LayoutTask | undefined;
  let highlighted = new Set<string>();
  const renderStartedAt = performance.now();
  let renderInProgress = false;
  let renderRuntimeError: Error | undefined;

  const captureRenderError = (event: ErrorEvent): void => {
    if (!renderInProgress || renderRuntimeError) return;
    renderRuntimeError =
      event.error instanceof Error
        ? event.error
        : new Error(event.message || "The Canvas renderer raised an asynchronous error.");
  };
  window.addEventListener("error", captureRenderError);

  const waitForCanvasPaint = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    if (renderRuntimeError) {
      throw new ResultGraphRuntimeError(
        "render",
        "GF_G6_CANVAS_RENDER_ERROR",
        renderRuntimeError.message,
      );
    }
    const canvases = [...graphElement.querySelectorAll("canvas")];
    const hasVisiblePixels = canvases.some((canvas) => {
      const context = canvas.getContext("2d");
      if (!context || canvas.width === 0 || canvas.height === 0) return false;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let alpha = 3; alpha < pixels.length; alpha += 4) {
        if (pixels[alpha] !== 0) return true;
      }
      return false;
    });
    if (!hasVisiblePixels) {
      throw new ResultGraphRuntimeError(
        "render",
        "GF_G6_CANVAS_EMPTY",
        "G6 completed without painting visible Canvas pixels.",
      );
    }
  };

  const reportAsyncFailure = (error: unknown): void => {
    if (destroyed || error instanceof ResultGraphLayoutCancelled) return;
    const failure =
      error instanceof ResultGraphRuntimeError
        ? error
        : new ResultGraphRuntimeError(
            hasRendered ? "render" : "initialize",
            "GF_G6_RENDER_FAILED",
            error instanceof Error ? error.message : String(error),
          );
    reportRenderFailure("g6", failure);
    if (!hasRendered) {
      destroyed = true;
      g6.destroy();
      setEmpty("The G6 graph could not be rendered.");
      if (fitButton) fitButton.disabled = true;
      if (relayoutButton) relayoutButton.disabled = true;
    }
  };

  const relayout = async (): Promise<void> => {
    const width = graphElement.clientWidth;
    const height = graphElement.clientHeight;
    if (!(width > 0) || !(height > 0)) {
      throw new ResultGraphRuntimeError(
        "layout",
        "GF_G6_INVALID_VIEWPORT",
        "The graph viewport has no measurable size.",
      );
    }
    activeLayout?.cancel();
    const layoutStartedAt = performance.now();
    post({
      type: "graphforge/layoutStarted",
      renderer: "g6",
      layout: options.layout.type,
      execution: options.layout.execution,
    });
    activeLayout = startG6Layout({
      nodes: current.nodes.map((node, index) => ({
        id: node.id,
        ...initialPosition(index, current.nodes.length),
      })),
      edges: renderedEdges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
      })),
      width,
      height,
      options: {
        maxIteration: options.layout.maxIteration,
        barnesHut: options.layout.barnesHut,
        prune: options.layout.prune,
        preventOverlap: options.layout.preventOverlap,
        dissuadeHubs: options.layout.dissuadeHubs,
        nodeSize: options.layout.nodeSize,
        nodeSpacing: options.layout.nodeSpacing,
        kr: options.layout.kr,
        kg: options.layout.kg,
        ks: options.layout.ks,
        ksmax: options.layout.ksmax,
        tao: options.layout.tao,
        mode: options.layout.mode,
      },
    });
    const result = await activeLayout.promise;
    post({
      type: "graphforge/layoutReady",
      renderer: "g6",
      layout: options.layout.type,
      execution: options.layout.execution,
      durationMs: performance.now() - layoutStartedAt,
    });
    if (destroyed) return;
    g6.updateNodeData(
      result.positions.map((position) => ({
        id: position.id,
        style: { x: position.x, y: position.y },
      })),
    );
    renderRuntimeError = undefined;
    renderInProgress = true;
    try {
      if (hasRendered) {
        await g6.draw();
      } else {
        await g6.render();
      }
      await g6.fitView({ when: "always" }, false);
      await waitForCanvasPaint();
    } finally {
      renderInProgress = false;
    }
    if (!hasRendered) {
      hasRendered = true;
      post({
        type: "graphforge/renderReady",
        renderer: "g6",
        backend: options.backend,
        nodeCount: current.nodes.length,
        edgeCount: renderedEdges.length,
        durationMs: performance.now() - renderStartedAt,
      });
    }
  };

  return {
    destroy: () => {
      destroyed = true;
      activeLayout?.cancel();
      window.removeEventListener("error", captureRenderError);
      g6.destroy();
    },
    fit: () => {
      if (hasRendered) {
        void g6.fitView({ when: "always" }, false).catch(reportAsyncFailure);
      }
    },
    relayout: () => {
      void relayout().catch(reportAsyncFailure);
    },
    highlight: (nodeIds, edgeIds) => {
      if (!hasRendered) return;
      const next = new Set([...nodeIds, ...edgeIds]);
      const states: Record<string, string[]> = {};
      for (const id of highlighted) states[id] = [];
      for (const id of next) states[id] = ["highlight"];
      highlighted = next;
      void g6
        .setElementState(states, false)
        .then(() => (next.size > 0 ? g6.focusElement([...next], false) : undefined))
        .catch(reportAsyncFailure);
    },
  };
}

function reportRenderFailure(
  failedRenderer: ResultGraphRenderer,
  error: unknown,
): void {
  const failure =
    error instanceof ResultGraphRuntimeError
      ? error
      : new ResultGraphRuntimeError(
          "initialize",
          "GF_RESULT_GRAPH_RENDER_FAILED",
          error instanceof Error ? error.message : String(error),
        );
  const resolved =
    failedRenderer === "g6" ? resolveResultGraphG6Options(viewOptions) : undefined;
  post({
    type: "graphforge/renderFailed",
    renderer: failedRenderer,
    phase: failure.phase,
    code: failure.code,
    backend: resolved?.backend,
    layout: resolved?.layout.type,
    message: failure.message,
  });
  runtimeBanner = `${failedRenderer === "g6" ? "AntV G6" : failedRenderer === "sigma" ? "Sigma" : "Cytoscape"} failed during ${failure.phase} (${failure.code}): ${failure.message}`;
  showBanner();
}

function bindRenderer(nextRenderer: RendererHandle): void {
  renderer = nextRenderer;
  scheduleInitialResultGraphLayout(
    nextRenderer,
    (callback) => requestAnimationFrame(callback),
    () => renderer === nextRenderer,
  );
}

function destroyRenderer(): void {
  renderer?.destroy();
  renderer = undefined;
  graphElement?.replaceChildren();
}

function render(): void {
  destroyRenderer();
  runtimeBanner = undefined;
  if (!payload) {
    setEmpty("Waiting for graph data…");
    if (fitButton) fitButton.disabled = true;
    if (relayoutButton) relayoutButton.disabled = true;
    return;
  }
  renderChrome(payload);
  if (payload.nodes.length === 0) {
    setEmpty("This result has no graph nodes.");
    if (fitButton) fitButton.disabled = true;
    if (relayoutButton) relayoutButton.disabled = true;
    return;
  }

  setEmpty(undefined);
  if (fitButton) fitButton.disabled = false;
  if (relayoutButton) relayoutButton.disabled = false;
  try {
    const renderStartedAt = performance.now();
    post({
      type: "graphforge/renderStarted",
      renderer: rendererKind,
      backend: viewOptions.backend,
      layout: viewOptions.layout?.type,
      nodeCount: payload.nodes.length,
      edgeCount: payload.edges.length,
    });
    const nextRenderer =
      rendererKind === "g6"
        ? createG6(payload)
        : rendererKind === "sigma"
          ? createSigma(payload)
          : createCytoscape(payload);
    bindRenderer(nextRenderer);
    if (rendererKind !== "g6") {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (renderer === nextRenderer) {
            post({
              type: "graphforge/renderReady",
              renderer: rendererKind,
              backend: viewOptions.backend,
              nodeCount: payload?.nodes.length ?? 0,
              edgeCount: payload?.edges.length ?? 0,
              durationMs: performance.now() - renderStartedAt,
            });
          }
        });
      });
    }
  } catch (error) {
    reportRenderFailure(rendererKind, error);
    setEmpty("The selected graph renderer could not be started.");
    if (fitButton) fitButton.disabled = true;
    if (relayoutButton) relayoutButton.disabled = true;
  }
}

function runRendererAction(
  phase: ResultGraphRenderPhase,
  code: string,
  action: () => void,
): void {
  try {
    action();
  } catch (error) {
    reportRenderFailure(
      rendererKind,
      new ResultGraphRuntimeError(
        phase,
        code,
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
}

fitButton?.addEventListener("click", () => {
  runRendererAction("interaction", "GF_RESULT_GRAPH_FIT_FAILED", () =>
    renderer?.fit(),
  );
});
relayoutButton?.addEventListener("click", () => {
  runRendererAction("layout", "GF_RESULT_GRAPH_LAYOUT_FAILED", () =>
    renderer?.relayout(),
  );
});
saveArtifactButton?.addEventListener("click", () => {
  post({ type: "graphforge/saveGraphArtifactState" });
});
revertArtifactButton?.addEventListener("click", () => {
  post({ type: "graphforge/revertGraphArtifactState" });
});

window.addEventListener("message", (event: MessageEvent<HostToWebview>) => {
  const message = event.data;
  if (!message || typeof message !== "object") {
    return;
  }
  if (message.type === "graphforge/graph") {
    payload = message.payload;
    render();
  } else if (message.type === "graphforge/graphRenderer") {
    const changed = rendererKind !== message.renderer;
    rendererKind = message.renderer;
    if (changed || !renderer) {
      render();
    }
  } else if (message.type === "graphforge/graphOptions") {
    viewOptions = {
      backend: message.backend,
      source: message.source,
      layout: message.layout,
      visualDensity: message.visualDensity,
      labels: message.labels,
      timebar: message.timebar,
    };
    if (renderer && payload) {
      render();
    }
  } else if (message.type === "graphforge/graphArtifactState") {
    if (saveArtifactButton) {
      saveArtifactButton.hidden = !message.saved;
      saveArtifactButton.disabled = !message.dirty;
    }
    if (revertArtifactButton) {
      revertArtifactButton.hidden = !message.saved;
      revertArtifactButton.disabled = !message.dirty;
    }
  } else if (message.type === "graphforge/highlightGraphElements") {
    runRendererAction(
      "interaction",
      "GF_RESULT_GRAPH_HIGHLIGHT_FAILED",
      () => renderer?.highlight(message.nodeIds, message.edgeIds),
    );
  }
});

window.addEventListener("resize", () => {
  if (renderer && payload) {
    runRendererAction("interaction", "GF_RESULT_GRAPH_RESIZE_FAILED", () =>
      renderer?.fit(),
    );
  }
});

post({ type: "graphforge/ready" });
