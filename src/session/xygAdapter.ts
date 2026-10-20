/**
 * GraphForge → XYG adapter (#80).
 *
 * Division of labour (graphforge-vscode#80 Rust/WASM amendment): GraphForge
 * computes; this module supplies XYG with the engine's Arrow IPC bytes, the
 * base graph, generation identity, and the caller's explicit intent. Rust
 * (XYG) owns recognition, joins, identity policy, composition, layout, and the
 * Scene on both the native Node host and the direct-browser WASM host. Nothing
 * here joins, lays out, encodes, or reduces data.
 *
 * Pure: no `vscode` import, so it is unit-testable against the real native
 * core and WASM artifact.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/** Intents a caller may request; XYG never picks one (ledger `intents`). */
export type XygIntent =
  | "graph"
  | "table"
  | "bar-chart"
  | "embedding-coordinates"
  | "parallel-coordinates";

export type XygHost = "native" | "wasm";
export const XYG_HOSTS: readonly XygHost[] = ["native", "wasm"];

/** Wire/ABI versions this extension was built and tested against. */
export const XYG_EXPECTED_VERSIONS = {
  nativeAbi: 378,
  wasmAbi: 27,
  composition: 1,
  ledger: 1,
} as const;

export interface XygLedgerEntry {
  schema: string;
  version: number;
  disposition: string;
  composition: string;
  intents: XygIntent[];
  fields: { name: string; kind: string }[];
  algorithms: string[];
}

export interface XygIdentity {
  kind: "node" | "edge";
  index: number;
  uuid: string | null;
  layers: { layer: number; resultId: string | null; row: number }[];
  derived?: boolean;
  type?: string | null;
  source?: string;
  target?: string;
  order?: number;
  path?: number;
}

export interface XygAggregatePick {
  kind: "aggregate";
  trace: number;
  nodeCount?: number | null;
  edgeCount?: number;
  edges?: XygIdentity[];
  truncated?: boolean;
}

interface XygLayerInfo {
  index: number;
  schema: string;
  schemaVersion: number;
  disposition: string;
  intent: string;
  resultId: string | null;
  nodeRows: BigUint64Array | null;
  edgeRows: BigUint64Array | null;
}

export interface XygComposition {
  readonly kind: "graph" | "table" | "bar-chart" | "parallel-coordinates" | "scatter";
  readonly version: number;
  readonly ledgerVersion: number;
  readonly bytes: Uint8Array;
  readonly layers: XygLayerInfo[];
  readonly nodes?: { count: number; uuid: string[] };
  readonly edges?: { count: number; uuid: (string | null)[]; derived: Uint8Array };
  readonly decisions: { code: string; layer: number | null; count: number }[];
  identify(kind: "node" | "edge", index: number): XygIdentity;
  select(uuids: readonly string[]): { nodes: number[]; edges: number[] };
  diagnostics(): XygCompositionDiagnostics;
}

/** Value-free summary: kinds, schema ids, counts, and decision codes only. */
export interface XygCompositionDiagnostics {
  kind: string;
  compositionVersion: number;
  ledgerVersion: number;
  rows?: number;
  nodes: number;
  edges: number;
  layers: {
    schema: string;
    schemaVersion: number;
    disposition: string;
    composition: string;
    intent: string;
    counts: Record<string, number>;
  }[];
  decisions: { code: string; layer: number | null; count: number }[];
}

export interface XygFigure {
  readonly __xygFigure?: never;
}

export interface XygWebviewPayload {
  figure: XygFigure;
  spec: unknown;
  buffer: ArrayBuffer;
  nodeTrace: number | null;
  edgeTrace: number | null;
  positions: unknown;
}

export interface XygComposeLayer {
  result: Uint8Array;
  intent: XygIntent;
  resultId: string;
  generation?: string;
  missing?: "dim" | "hide" | "keep" | "error";
  extra?: "error" | "drop";
}

export interface XygComposeInput {
  base?: { tables: Uint8Array[]; generation?: string };
  layers: XygComposeLayer[];
  select?: string[];
}

/** The subset of `@curatelabs/xyg-node/graphforge` this extension uses. */
export interface XygGraphForgeApi {
  composeGraphForge(input: XygComposeInput): XygComposition;
  encodeGraphForgeRequest(input: XygComposeInput): Uint8Array;
  composeGraphForgeRequest(request: Uint8Array): Uint8Array;
  decodeGraphForgeDocument(document: Uint8Array): XygComposition;
  graphforgeWebviewPayload(
    composition: XygComposition,
    opts: { width: number; height: number; theme?: "light" | "dark"; positions?: unknown },
  ): XygWebviewPayload;
  graphforgePick(
    figure: XygFigure,
    composition: XygComposition,
    pick: { trace: number; index: number },
  ): XygIdentity | XygAggregatePick | null;
  graphforgeTableHtml(composition: XygComposition): string;
  graphforgeLedger(): XygLedgerEntry[];
  GRAPHFORGE_COMPOSITION_VERSION: number;
}

export type XygLoadResult =
  | { ok: true; api: XygGraphForgeApi; abiVersion: number }
  | { ok: false; code: string; message: string };

interface XygLoadModule {
  loadXygNode(): Promise<
    { ok: true; abiVersion: number } | { ok: false; code: string; message: string }
  >;
}

/**
 * Import an external ESM package from the CJS extension bundle. The specifier
 * is resolved from this bundle's location (dist/node_modules in the VSIX,
 * the repo's node_modules in development) and imported by absolute file URL,
 * so the result never depends on the process working directory. `Function`
 * keeps the bundler from rewriting `import()` into `require()`.
 */
const nativeImport = new Function("url", "return import(url)") as (url: string) => Promise<unknown>;
export function importEsm(specifier: string): Promise<unknown> {
  const resolved = createRequire(__filename).resolve(specifier);
  return nativeImport(pathToFileURL(resolved).href);
}

let cachedLoad: Promise<XygLoadResult> | undefined;

/**
 * Load the native XYG Node host once. Never throws: failures carry XYG's
 * stable `XYG_NATIVE_*` / `XYG_NODE_*` code and a path-free message. The
 * extension never substitutes another renderer when this fails.
 */
export function loadXygNative(
  importer: (specifier: string) => Promise<unknown> = importEsm,
): Promise<XygLoadResult> {
  if (importer === importEsm && cachedLoad) return cachedLoad;
  const attempt = (async (): Promise<XygLoadResult> => {
    let load: XygLoadModule;
    try {
      load = (await importer("@curatelabs/xyg-node/load")) as XygLoadModule;
    } catch {
      return {
        ok: false,
        code: "XYG_NODE_IMPORT_FAILED",
        message: "The bundled XYG Node host could not be imported. Reinstall GraphForge for VS Code.",
      };
    }
    const loaded = await load.loadXygNode();
    if (!loaded.ok) return { ok: false, code: loaded.code, message: loaded.message };
    if (loaded.abiVersion !== XYG_EXPECTED_VERSIONS.nativeAbi) {
      return {
        ok: false,
        code: "XYG_NATIVE_ABI_MISMATCH",
        message: `XYG native ABI ${loaded.abiVersion} does not match the ABI ${XYG_EXPECTED_VERSIONS.nativeAbi} this extension was built for.`,
      };
    }
    const api = (await importer("@curatelabs/xyg-node/graphforge")) as XygGraphForgeApi;
    if (api.GRAPHFORGE_COMPOSITION_VERSION !== XYG_EXPECTED_VERSIONS.composition) {
      return {
        ok: false,
        code: "GF_COMPOSE_VERSION",
        message: `XYG composition version ${api.GRAPHFORGE_COMPOSITION_VERSION} is not the supported version ${XYG_EXPECTED_VERSIONS.composition}.`,
      };
    }
    return { ok: true, api, abiVersion: loaded.abiVersion };
  })();
  if (importer === importEsm) cachedLoad = attempt;
  return attempt;
}

/** A stable, value-free failure surfaced to commands, agents, and the panel. */
export class XygVisualizationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly nextAction: string,
    readonly layer: number | null = null,
    readonly field: string | null = null,
  ) {
    super(`${message} ${nextAction}`);
    this.name = "XygVisualizationError";
  }
}

const NEXT_ACTIONS: Record<string, string> = {
  GF_COMPOSE_GENERATION_STALE:
    "The graph changed since this result was computed. Re-run the query or verb, then visualize it again.",
  GF_COMPOSE_GENERATION_MISSING:
    "Re-run the result inside an open GraphForge project so its generation is recorded.",
  GF_COMPOSE_EXTRA_IDS:
    "The result names entities that are not in the current graph. Re-run it against the current generation.",
  GF_COMPOSE_INTENT_UNSUPPORTED: "Choose one of the intents offered for this result.",
  GF_COMPOSE_COORDINATES_REQUIRED:
    "Embeddings need 2D coordinates; use the parallel-coordinates view instead.",
  GF_COMPOSE_SCENE_TOO_LARGE:
    "The browser (WASM) host draws at most 1,024 nodes plus edges. Set graphforge.visualization.xygHost to native, or filter the result.",
  GF_COMPOSE_TOO_LARGE: "Filter the result or the base graph, then visualize it again.",
  GF_COMPOSE_SCENE_EMPTY: "Every node is hidden by the layer policy; nothing can be drawn.",
  GF_RESULT_SCHEMA_UNREGISTERED: "Update GraphForge for VS Code, or keep this result in the Results table.",
  GF_RESULT_SCHEMA_VERSION: "Use GraphForge and extension releases with matching result schema versions.",
  GF_RESULT_SCHEMA_MISMATCH: "Re-run the result with a GraphForge engine that matches this extension.",
  XYG_NATIVE_UNSUPPORTED_PLATFORM:
    "Set graphforge.visualization.xygHost to wasm to draw small results in the browser host.",
  XYG_NATIVE_LIBRARY_MISSING: "Reinstall GraphForge for VS Code for this platform.",
  XYG_NATIVE_ABI_MISMATCH: "Reinstall GraphForge for VS Code; its XYG native core is a different version.",
};

const DEFAULT_NEXT_ACTION = "Keep this result in the Results table, or re-run it and try again.";

/** Map any XYG failure (`GraphForgeCompositionError`, load failure) to one coded error. */
export function toXygError(err: unknown): XygVisualizationError {
  if (err instanceof XygVisualizationError) return err;
  const record = (err && typeof err === "object" ? err : {}) as {
    code?: unknown;
    message?: unknown;
    layer?: unknown;
    field?: unknown;
  };
  const code = typeof record.code === "string" ? record.code : "XYG_COMPOSE_FAILED";
  const raw = typeof record.message === "string" ? record.message : String(err);
  // XYG messages are value-free; strip the duplicated "CODE: " prefix.
  const message = raw.startsWith(`${code}: `) ? raw.slice(code.length + 2) : raw;
  return new XygVisualizationError(
    code,
    message,
    NEXT_ACTIONS[code] ?? DEFAULT_NEXT_ACTION,
    typeof record.layer === "number" ? record.layer : null,
    typeof record.field === "string" ? record.field : null,
  );
}

/** Engine verbs whose results are XYG result layers (Cypher results are base material). */
const LAYER_VERBS = new Set(["rank", "cluster", "similar", "paths", "analyze", "find"]);

/** Whether a result's preserved Arrow metadata marks it as an XYG result layer. */
export function isXygResultLayer(metadata: Record<string, string> | undefined): boolean {
  const verb = metadata?.["graphforge.verb"];
  return verb !== undefined && LAYER_VERBS.has(verb);
}

/**
 * The ledger entry XYG's Rust ledger registers for a result, looked up by the
 * engine metadata (`graphforge.algorithm`, or `find` → `search`). Undefined
 * when XYG has no entry; composing then fails with XYG's own coded error.
 */
export function ledgerEntryFor(
  ledger: readonly XygLedgerEntry[],
  metadata: Record<string, string> | undefined,
): XygLedgerEntry | undefined {
  if (metadata?.["graphforge.verb"] === "find") {
    return ledger.find((entry) => entry.schema === "search");
  }
  const algorithm = metadata?.["graphforge.algorithm"];
  return algorithm ? ledger.find((entry) => entry.algorithms.includes(algorithm)) : undefined;
}

/**
 * Intents the caller may choose for this result. `embedding-coordinates`
 * needs caller-supplied 2D coordinates, which this extension does not
 * produce, so it is offered only when coordinates exist.
 */
export function selectableIntents(
  entry: XygLedgerEntry | undefined,
  options: { hasCoordinates?: boolean } = {},
): XygIntent[] {
  if (!entry) return [];
  return entry.intents.filter(
    (intent) => intent !== "embedding-coordinates" || options.hasCoordinates === true,
  );
}

/** Graph intents join onto a base graph read at the same generation. */
export function intentNeedsBase(intent: XygIntent): boolean {
  return intent === "graph";
}

export interface XygRequestParts {
  result: Uint8Array;
  intent: XygIntent;
  resultId: string;
  generation?: string;
  base?: { tables: Uint8Array[]; generation?: string };
  select?: string[];
}

/** Build the one compose input shared by the native and WASM hosts. */
export function composeInput(parts: XygRequestParts): XygComposeInput {
  const layer: XygComposeLayer = {
    result: parts.result,
    intent: parts.intent,
    resultId: parts.resultId,
  };
  if (parts.generation) layer.generation = parts.generation;
  const input: XygComposeInput = { layers: [layer] };
  if (parts.base) {
    input.base = parts.base.generation
      ? { tables: parts.base.tables, generation: parts.base.generation }
      : { tables: parts.base.tables };
  }
  if (parts.select && parts.select.length > 0) input.select = [...parts.select];
  return input;
}

const NONE_ROW = 0xffffffffffffffffn;

/**
 * Result row → composed identities for one layer, read from Rust's per-element
 * row planes (no extension-side join). Derived edges have no UUID, so their
 * endpoints represent them.
 */
export function rowIdentities(
  composition: XygComposition,
  resultId: string,
): Map<number, string[]> {
  const rows = new Map<number, string[]>();
  const add = (row: bigint, uuid: string | null | undefined) => {
    if (row === NONE_ROW || !uuid) return;
    const key = Number(row);
    const list = rows.get(key);
    if (list) {
      if (!list.includes(uuid)) list.push(uuid);
    } else {
      rows.set(key, [uuid]);
    }
  };
  for (const layer of composition.layers) {
    if (layer.resultId !== resultId) continue;
    if (layer.nodeRows && composition.nodes) {
      for (let i = 0; i < composition.nodes.count; i++) {
        add(layer.nodeRows[i], composition.nodes.uuid[i]);
      }
    }
    if (layer.edgeRows && composition.edges) {
      for (let j = 0; j < composition.edges.count; j++) {
        const row = layer.edgeRows[j];
        if (row === NONE_ROW) continue;
        const uuid = composition.edges.uuid[j];
        if (uuid) {
          add(row, uuid);
        } else {
          const identity = composition.identify("edge", j);
          add(row, identity.source);
          add(row, identity.target);
        }
      }
    }
  }
  return rows;
}

/** Result rows a pick names for one result id (aggregates expand to members). */
export function pickRows(
  pick: XygIdentity | XygAggregatePick | null,
  resultId: string,
): number[] {
  if (!pick) return [];
  const identities = pick.kind === "aggregate" ? pick.edges ?? [] : [pick];
  const rows = new Set<number>();
  for (const identity of identities) {
    for (const layer of identity.layers) {
      if (layer.resultId === resultId) rows.add(layer.row);
    }
  }
  return [...rows].sort((a, b) => a - b);
}
