import cytoscape, { type Core, type LayoutOptions } from "cytoscape";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Sigma from "sigma";
import type { GraphPayload } from "../../../src/session/types";
import {
  CLASS_COLOR_PALETTE,
  type HostToWebview,
  type WebviewToHost,
} from "../../../src/webview/protocol";
import {
  classColor,
  classOf,
  graphItemColor,
  nodeLabel,
  type ResultGraphLayoutOptions,
  type ResultGraphRenderer,
} from "../../../src/webview/resultGraphModel";
import { scheduleInitialResultGraphLayout } from "../../../src/webview/resultGraphLayout";
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

let payload: GraphPayload | undefined;
let rendererKind: ResultGraphRenderer = "cytoscape";
let layoutOptions: ResultGraphLayoutOptions = {};
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
      rendererKind === "cytoscape" ? "Cytoscape renderer" : "Sigma renderer";
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
  const count = cy.nodes().length;
  const options: LayoutOptions = {
    name: "cose",
    animate: false,
    randomize: false,
    fit,
    padding: 36,
    nodeRepulsion: () =>
      layoutOptions.nodeRepulsion ?? (count > 400 ? 180_000 : 90_000),
    idealEdgeLength: () =>
      layoutOptions.idealEdgeLength ?? (count > 400 ? 42 : 70),
    edgeElasticity: () => 100,
    gravity: layoutOptions.gravity ?? 0.7,
    numIter: count > 400 ? 400 : 900,
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
  const showEdgeLabels = current.edges.length <= 350;
  const cy = cytoscape({
    container: graphElement,
    elements: [
      ...current.nodes.map((node, index) => ({
        group: "nodes" as const,
        data: {
          id: node.id,
          label: nodeLabel(node).slice(0, 32),
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
            label: showEdgeLabels ? edge.type : "",
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
          width: current.nodes.length > 400 ? 12 : 22,
          height: current.nodes.length > 400 ? 12 : 22,
        },
      },
      {
        selector: "edge",
        style: {
          width: current.edges.length > 2_000 ? 0.55 : 1.3,
          "line-color":
            current.styleMode === "class-only" ? muted : "data(color)",
          "target-arrow-color":
            current.styleMode === "class-only" ? muted : "data(color)",
          "target-arrow-shape": current.edges.length > 2_000 ? "none" : "triangle",
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
  const graph = new Graph({ multi: true, type: "directed", allowSelfLoops: true });
  for (const [index, node] of current.nodes.entries()) {
    graph.addNode(node.id, {
      ...initialPosition(index, current.nodes.length),
      size: current.nodes.length > 400 ? 2.5 : 5,
      color: graphItemColor(node, current),
      label: nodeLabel(node).slice(0, 40),
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
      size: current.edges.length > 2_000 ? 0.35 : 1,
      color,
      baseColor: color,
      label: current.edges.length <= 350 ? edge.type : "",
    });
  }

  const iterations = current.nodes.length > 400 ? 45 : 90;
  const sigma = new Sigma(graph, graphElement, {
    enableEdgeEvents: true,
    renderEdgeLabels: current.edges.length <= 350,
    labelColor: { color: themeValue("--vscode-editor-foreground", "#cccccc") },
    labelDensity: current.nodes.length > 400 ? 0.25 : 1,
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
        iterations,
        settings: {
          ...forceAtlas2.inferSettings(graph),
          barnesHutOptimize: current.nodes.length > 200,
          gravity: layoutOptions.gravity ?? 1,
          slowDown:
            layoutOptions.slowDown ?? (current.nodes.length > 400 ? 8 : 3),
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
            ? (current.nodes.length > 400 ? 5 : 9)
            : (current.nodes.length > 400 ? 2.5 : 5),
        );
      });
      graph.forEachEdge((edge) => {
        graph.setEdgeAttribute(
          edge,
          "size",
          selectedEdges.has(edge)
            ? 4
            : (current.edges.length > 2_000 ? 0.35 : 1),
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
    bindRenderer(
      rendererKind === "sigma" ? createSigma(payload) : createCytoscape(payload),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    post({ type: "graphforge/renderFailed", renderer: rendererKind, message });
    if (rendererKind === "sigma") {
      runtimeBanner = `Sigma could not start (${message}). Showing Cytoscape for this graph.`;
      bindRenderer(createCytoscape(payload));
    } else {
      runtimeBanner = `Could not render graph: ${message}`;
      setEmpty("The graph could not be rendered.");
    }
    showBanner();
  }
}

fitButton?.addEventListener("click", () => renderer?.fit());
relayoutButton?.addEventListener("click", () => renderer?.relayout());

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
    layoutOptions = message.layout ?? {};
    if (renderer && payload) {
      render();
    }
  } else if (message.type === "graphforge/highlightGraphElements") {
    renderer?.highlight(message.nodeIds, message.edgeIds);
  }
});

window.addEventListener("resize", () => {
  if (renderer && payload) {
    renderer.fit();
  }
});

post({ type: "graphforge/ready" });
