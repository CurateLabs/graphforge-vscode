#!/usr/bin/env node
/**
 * Opt-in visualization benchmark for issue #67.
 *
 * The default run measures deterministic adapter preparation. --layout-tier
 * additionally runs each renderer's configured layout algorithm against the
 * same payload in Node.js. Browser paint, interaction latency, and peak browser
 * memory still require the Extension Development Host matrix in TESTING.md.
 *
 * Usage:
 *   node scripts/benchmark-visualizations.mjs [--iterations 7] [--layout-tier small|medium|large|all]
 *     [--layout-timeout-ms 60000] [--output path]
 */
import { createHash } from "node:crypto";
import { ForceAtlas2Layout } from "@antv/layout";
import cytoscape from "cytoscape";
import * as fs from "node:fs";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const DEFAULT_ITERATIONS = 7;
const DEFAULT_LAYOUT_TIMEOUT_MS = 60_000;

function parseArgs(argv) {
  let iterations = DEFAULT_ITERATIONS;
  let output;
  let layoutTier;
  let layoutTimeoutMs = DEFAULT_LAYOUT_TIMEOUT_MS;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--iterations") {
      iterations = Number(argv[++index]);
    } else if (arg === "--output") {
      output = argv[++index];
    } else if (arg === "--layout-tier") {
      layoutTier = argv[++index];
    } else if (arg === "--layout-timeout-ms") {
      layoutTimeoutMs = Number(argv[++index]);
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/benchmark-visualizations.mjs [--iterations 7] [--layout-tier small|medium|large|all] [--layout-timeout-ms 60000] [--output path]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100) {
    throw new Error("--iterations must be an integer from 1 through 100");
  }
  if (layoutTier !== undefined && !["small", "medium", "large", "all"].includes(layoutTier)) {
    throw new Error("--layout-tier must be small, medium, large, or all");
  }
  if (!Number.isInteger(layoutTimeoutMs) || layoutTimeoutMs < 1_000 || layoutTimeoutMs > 600_000) {
    throw new Error("--layout-timeout-ms must be an integer from 1000 through 600000");
  }
  return { iterations, output, layoutTier, layoutTimeoutMs };
}

function deterministicGraph(name, nodeCount, edgeCount) {
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: `${name}-node-${index}`,
    labels: [index % 3 === 0 ? "Airport" : index % 3 === 1 ? "Region" : "Route"],
    properties: { label: `${name} ${index}`, ordinal: index },
    epistemicStatus: index % 5 === 0 ? "hypothesis" : "supported",
  }));
  const edges = Array.from({ length: edgeCount }, (_, index) => ({
    id: `${name}-edge-${index}`,
    source: nodes[index % nodeCount].id,
    target: nodes[(index * 17 + 11) % nodeCount].id,
    type: index % 2 === 0 ? "ROUTE" : "RELATED_TO",
    epistemicStatus: index % 7 === 0 ? "hypothesis" : "supported",
  }));
  return { name, nodes, edges };
}

function parseCsvLine(line) {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  cells.push(value);
  return cells;
}

function readCsv(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function airRoutesGraph() {
  const sampleRoot = path.join(repoRoot, "media", "samples", "air-routes");
  const airports = readCsv(path.join(sampleRoot, "airports.csv"));
  const routes = readCsv(path.join(sampleRoot, "routes.csv"));
  const ids = new Set(airports.map((airport) => airport.id));
  return {
    name: "air-routes",
    nodes: airports.map((airport) => ({
      id: airport.id,
      labels: ["Airport"],
      properties: {
        label: airport.code,
        city: airport.city,
        region: airport.region,
      },
      epistemicStatus: "supported",
    })),
    edges: routes
      .filter((route) => ids.has(route.from) && ids.has(route.to))
      .map((route, index) => ({
        id: `route-${index}`,
        source: route.from,
        target: route.to,
        type: "ROUTE",
        epistemicStatus: "supported",
      })),
  };
}

const candidates = [
  {
    renderer: "g6",
    config: {
      backend: "canvas",
      layout: {
        type: "force-atlas2",
        execution: "worker",
        animation: false,
        maxIteration: 500,
        barnesHut: true,
        prune: true,
        preventOverlap: true,
        dissuadeHubs: false,
        nodeSize: 22,
        nodeSpacing: 4,
        kr: 5,
        kg: 1,
        ks: 0.1,
        ksmax: 10,
        tao: 0.1,
        mode: "normal",
      },
    },
    prepare(payload) {
      return {
        nodes: payload.nodes.map((node) => ({
          id: node.id,
          data: { labels: node.labels, properties: node.properties },
          style: { labelText: node.properties.label },
        })),
        edges: payload.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          data: { type: edge.type },
        })),
      };
    },
  },
  {
    renderer: "cytoscape",
    config: {
      backend: "canvas",
      layout: {
        type: "cose",
        animation: false,
        maxIterations: 900,
        gravity: 0.7,
        nodeRepulsion: 90_000,
        idealEdgeLength: 70,
      },
    },
    prepare(payload) {
      return [
        ...payload.nodes.map((node) => ({
          group: "nodes",
          data: { id: node.id, label: node.properties.label, labels: node.labels },
        })),
        ...payload.edges.map((edge) => ({
          group: "edges",
          data: {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            label: edge.type,
          },
        })),
      ];
    },
  },
  {
    renderer: "sigma",
    config: {
      backend: "webgl",
      layout: {
        type: "force-atlas2",
        execution: "main",
        iterations: 90,
        gravity: 1,
        slowDown: 3,
        barnesHutOptimize: true,
      },
    },
    prepare(payload) {
      return {
        nodes: payload.nodes.map((node, index) => ({
          key: node.id,
          attributes: { label: node.properties.label, x: index, y: index, size: 1 },
        })),
        edges: payload.edges.map((edge) => ({
          key: edge.id,
          source: edge.source,
          target: edge.target,
          attributes: { label: edge.type, size: 1 },
        })),
      };
    },
  },
];

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.min(sorted.length - 1, index)];
}

function round(value) {
  return Number(value.toFixed(3));
}

function measure(candidate, payload, iterations) {
  candidate.prepare(payload);
  const durations = [];
  let prepared;
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    prepared = candidate.prepare(payload);
    durations.push(performance.now() - started);
  }
  const serialized = JSON.stringify(prepared);
  return {
    renderer: candidate.renderer,
    config: candidate.config,
    preparation: {
      iterations,
      minMs: round(Math.min(...durations)),
      medianMs: round(percentile(durations, 0.5)),
      p95Ms: round(percentile(durations, 0.95)),
      maxMs: round(Math.max(...durations)),
      serializedBytes: Buffer.byteLength(serialized),
      sha256: createHash("sha256").update(serialized).digest("hex"),
    },
  };
}

function initialPosition(index, count) {
  const angle = (index / Math.max(1, count)) * Math.PI * 2;
  return { x: 400 + Math.cos(angle) * 240, y: 300 + Math.sin(angle) * 240 };
}

async function measureLayout(candidate, payload) {
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  if (candidate.renderer === "g6") {
    const layout = new ForceAtlas2Layout();
    try {
      await layout.execute({
        nodes: payload.nodes.map((node, index) => ({
          id: node.id,
          ...initialPosition(index, payload.nodes.length),
        })),
        edges: payload.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
        })),
      }, {
        ...candidate.config.layout,
        center: [400, 300],
        width: 800,
        height: 600,
        dimensions: 2,
        enableWorker: false,
      });
    } finally {
      layout.destroy();
    }
  } else if (candidate.renderer === "cytoscape") {
    const options = candidate.config.layout;
    const graph = cytoscape({
      headless: true,
      elements: [
        ...payload.nodes.map((node) => ({ group: "nodes", data: { id: node.id } })),
        ...payload.edges.map((edge) => ({
          group: "edges",
          data: { id: edge.id, source: edge.source, target: edge.target },
        })),
      ],
    });
    try {
      graph.layout({
        name: "cose",
        animate: false,
        numIter: options.maxIterations,
        gravity: options.gravity,
        nodeRepulsion: () => options.nodeRepulsion,
        idealEdgeLength: () => options.idealEdgeLength,
      }).run();
    } finally {
      graph.destroy();
    }
  } else {
    const options = candidate.config.layout;
    const graph = new Graph({ multi: true, type: "directed" });
    payload.nodes.forEach((node, index) => {
      graph.addNode(node.id, { ...initialPosition(index, payload.nodes.length), size: 22 });
    });
    payload.edges.forEach((edge) => {
      graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target);
    });
    forceAtlas2.assign(graph, {
      iterations: options.iterations,
      settings: {
        gravity: options.gravity,
        slowDown: options.slowDown,
        barnesHutOptimize: options.barnesHutOptimize,
      },
    });
  }
  return {
    runs: 1,
    durationMs: round(performance.now() - started),
    heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
    environment: "Node.js algorithm execution; not browser paint or interaction",
  };
}

function measureLayoutInWorker(candidate, payload, timeoutMs) {
  return new Promise((resolve) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { mode: "layout", renderer: candidate.renderer, payload },
    });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({
        runs: 0,
        timedOut: true,
        timeoutMs,
        environment: "Node.js worker terminated at the explicit layout evidence budget",
      });
      void worker.terminate();
    }, timeoutMs);
    worker.once("message", (message) => {
      finish(message);
      void worker.terminate();
    });
    worker.once("error", (error) => {
      finish({
        runs: 0,
        error: error.message,
        environment: "Node.js layout worker failure; not browser paint or interaction",
      });
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        finish({
          runs: 0,
          error: `Layout worker exited with code ${code}.`,
          environment: "Node.js layout worker failure; not browser paint or interaction",
        });
      }
    });
  });
}

async function main() {
  const { iterations, output, layoutTier, layoutTimeoutMs } = parseArgs(process.argv.slice(2));
  const tiers = [
    { tier: "small", source: "deterministic-generated", payload: deterministicGraph("small", 100, 400) },
    { tier: "medium", source: "vendored-air-routes", payload: airRoutesGraph() },
    { tier: "large", source: "deterministic-generated", payload: deterministicGraph("large", 5_000, 30_000) },
  ];

  const report = {
    format: "graphforge.visualization-benchmark/v1",
    generatedAt: new Date().toISOString(),
    scope: {
      measured: "deterministic renderer-adapter data preparation, plus opt-in layout algorithm execution in isolated Node.js workers",
      layoutTimeoutMs,
      memoryMeasurement: "heap delta after layout where the runtime exposes it; not peak memory",
      notMeasured: [
        "browser renderer construction or paint",
        "Canvas or WebGL throughput",
        "browser worker or WASM layout time",
        "pan, zoom, selection, or playback responsiveness",
        "browser peak memory",
      ],
      browserRendererProof: false,
    },
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
    },
    tiers: [],
  };

  for (const { tier, source, payload } of tiers) {
    const includeLayout = layoutTier === "all" || layoutTier === tier;
    const results = [];
    for (const candidate of candidates) {
      console.log(`Measuring ${tier}/${candidate.renderer}${includeLayout ? " with layout" : " preparation"}...`);
      results.push({
        ...measure(candidate, payload, iterations),
        ...(includeLayout
          ? { layout: await measureLayoutInWorker(candidate, payload, layoutTimeoutMs) }
          : {}),
      });
    }
    report.tiers.push({
      tier,
      source,
      counts: { nodes: payload.nodes.length, edges: payload.edges.length },
      results,
    });
  }

  const outputPath = path.resolve(
    output ?? path.join(os.tmpdir(), "graphforge-visualization-benchmark.json"),
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Wrote visualization benchmark to ${outputPath}`);
  console.log("Browser paint and interaction proof are intentionally not measured by this script.");
}

if (isMainThread) {
  await main();
} else if (workerData?.mode === "layout") {
  const candidate = candidates.find(({ renderer }) => renderer === workerData.renderer);
  if (!candidate) throw new Error(`Unknown renderer worker: ${String(workerData.renderer)}`);
  try {
    parentPort?.postMessage(await measureLayout(candidate, workerData.payload));
  } catch (error) {
    parentPort?.postMessage({
      runs: 0,
      error: error instanceof Error ? error.message : String(error),
      environment: "Node.js layout worker failure; not browser paint or interaction",
    });
  }
}
