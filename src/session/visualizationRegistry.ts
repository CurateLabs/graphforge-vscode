import type { ResultFilter } from "./projectArtifacts";

export const VISUALIZATION_SPEC_FORMAT_V2 = "graphforge.visualization/v2" as const;

export type VisualizationKindV2 =
  | "result-graph"
  | "chart"
  | "geospatial"
  | "temporal";

export interface VisualizationV2Base {
  format: typeof VISUALIZATION_SPEC_FORMAT_V2;
  name: string;
  kind: VisualizationKindV2;
  /** Project-relative path to a persisted GraphForge result. */
  result: string;
  /** Required even when empty so filtering is never inferred. */
  filters: ResultFilter[];
  /** Compatibility-only property for callers transitioning from v1. Rejected by v2 validation. */
  filter?: never;
  /** Compatibility-only property for callers transitioning from v1. Rejected by v2 validation. */
  plotly?: never;
}

export type GraphRendererV2 =
  | { id: "g6"; backend: "canvas" }
  | { id: "cytoscape"; backend: "canvas" }
  | { id: "sigma"; backend: "webgl" };

export type GraphLayoutV2 =
  | {
      type: "force-atlas2";
      execution: "worker";
      animation: false;
      maxIteration: number;
      barnesHut: boolean;
      prune: boolean;
      preventOverlap: boolean;
      dissuadeHubs: boolean;
      nodeSize: number;
      nodeSpacing: number;
      kr: number;
      kg: number;
      ks: number;
      ksmax: number;
      tao: number;
      mode: "normal" | "linlog";
    }
  | {
      type: "cose";
      execution: "main";
      animation: boolean;
      maxIterations: number;
      gravity: number;
      nodeRepulsion: number;
      idealEdgeLength: number;
    }
  | {
      type: "force-atlas2";
      execution: "main";
      animation: false;
      iterations: number;
      gravity: number;
      slowDown: number;
      barnesHutOptimize: boolean;
    };

export type GraphTimebarV2 =
  | { enabled: false }
  | {
      enabled: true;
      nodeTimestampField: string | null;
      edgeTimestampField: string | null;
      timezone: string;
      range: { start: string; end: string };
      stepMs: number;
      windowMs: number;
      playbackIntervalMs: number;
    };

export interface ResultGraphVisualizationSpecV2 extends VisualizationV2Base {
  kind: "result-graph";
  renderer: GraphRendererV2;
  graph: {
    /** Compatibility-only property for callers transitioning from v1. Rejected by v2 validation. */
    renderer?: never;
    layout: GraphLayoutV2;
    style: {
      preset: "graphforge-epistemic/v1" | "graphforge-class/v1";
      nodeLabelFields: string[];
      nodeLabelFallback: "label-or-id" | "id";
      edgeLabelField: "type" | null;
      showEdgeLabels: boolean;
      nodeSize: number;
      edgeWidth: number;
      arrowheads: boolean;
    };
    interactions: {
      pan: true;
      zoom: true;
      select: true;
      fit: true;
      relayout: true;
    };
    timebar: GraphTimebarV2;
  };
}

export type ChartRendererV2 = { id: "g2" } | { id: "plotly" };
export type ChartMarkV2 = "bar" | "scatter" | "line" | "histogram";

export interface ChartVisualizationSpecV2 extends VisualizationV2Base {
  kind: "chart";
  renderer: ChartRendererV2;
  chart: {
    mark: ChartMarkV2;
    bindings: {
      x: string;
      y: string | null;
      color: string | null;
      size: string | null;
      shape: string | null;
      series: string | null;
    };
    aggregation: "none" | "count" | "sum" | "average" | "minimum" | "maximum";
    /** Histogram binning is always persisted; non-histogram marks disable it. */
    binning: { enabled: false; thresholds: null } | { enabled: true; thresholds: number };
    sort: Array<{ field: string; direction: "ascending" | "descending" }>;
    axes: { x: boolean; y: boolean };
    legend: boolean;
    theme: "editor";
    animation: false;
    title: string | null;
  };
}

export type GeospatialSourceV2 =
  | {
      type: "coordinates";
      longitudeField: string;
      latitudeField: string;
    }
  | { type: "geojson"; geometryField: string };

export interface GeospatialLayerV2 {
  id: string;
  type: "point" | "line" | "polygon";
  /** v2 currently supports constant layer styling only; mappings are explicit nulls. */
  colorField: null;
  sizeField: null;
  shapeField: null;
  color: string;
  opacity: number;
  size: number;
}

export interface GeospatialVisualizationSpecV2 extends VisualizationV2Base {
  kind: "geospatial";
  renderer: { id: "l7"; backend: "device" };
  geospatial: {
    source: GeospatialSourceV2;
    sourceCrs: "EPSG:4326";
    projection: "EPSG:3857";
    aggregation: "none";
    layers: GeospatialLayerV2[];
    basemap: { type: "blank" };
    viewport: {
      longitude: number;
      latitude: number;
      zoom: number;
      bearing: number;
      pitch: number;
      bounds: null;
    };
    presentation: {
      title: string | null;
      legend: false;
      theme: "editor";
    };
  };
}

export interface TemporalVisualizationSpecV2 extends VisualizationV2Base {
  kind: "temporal";
  renderer: { id: "g2" };
  temporal: {
    mark: "line" | "bar" | "point";
    timestampField: string;
    timezone: string;
    granularity:
      | "millisecond"
      | "second"
      | "minute"
      | "hour"
      | "day"
      | "week"
      | "month"
      | "quarter"
      | "year";
    valueField: string;
    aggregation: "none" | "count" | "sum" | "average" | "minimum" | "maximum";
    seriesField: string | null;
    sort: "ascending" | "descending";
    range: { start: string | null; end: string | null };
    /** v2 does not support windowing yet; both fields are explicit fixed values. */
    window: { size: null; unit: "point" };
    playback:
      | { enabled: false; step: null; speedMs: null }
      | { enabled: true; step: number; speedMs: number };
    axes: { time: boolean; value: boolean };
    legend: boolean;
    theme: "editor";
    animation: false;
    title: string | null;
  };
}

export type ProjectVisualizationSpecV2 =
  | ResultGraphVisualizationSpecV2
  | ChartVisualizationSpecV2
  | GeospatialVisualizationSpecV2
  | TemporalVisualizationSpecV2;

export const DEFAULT_VISUALIZATION_POLICY = Object.freeze({
  resultGraph: Object.freeze({
    renderer: Object.freeze({ id: "g6" as const, backend: "canvas" as const }),
    layout: Object.freeze({
      type: "force-atlas2" as const,
      execution: "worker" as const,
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
      mode: "normal" as const,
    }),
  }),
  chart: Object.freeze({ renderer: Object.freeze({ id: "g2" as const }) }),
  geospatial: Object.freeze({ renderer: Object.freeze({ id: "l7" as const, backend: "device" as const }) }),
  temporal: Object.freeze({ renderer: Object.freeze({ id: "g2" as const }) }),
});

interface TemplateBaseInput {
  name: string;
  result: string;
  filters?: ResultFilter[];
}

function copyFilters(filters: ResultFilter[] | undefined): ResultFilter[] {
  return (filters ?? []).map((filter) => ({ ...filter }));
}

export function createResultGraphSpec(
  input: TemplateBaseInput & { renderer?: GraphRendererV2["id"] },
): ResultGraphVisualizationSpecV2 {
  const renderer: GraphRendererV2 =
    input.renderer === "cytoscape"
      ? { id: "cytoscape", backend: "canvas" }
      : input.renderer === "sigma"
        ? { id: "sigma", backend: "webgl" }
        : { ...DEFAULT_VISUALIZATION_POLICY.resultGraph.renderer };
  const layout: GraphLayoutV2 =
    renderer.id === "cytoscape"
      ? {
          type: "cose",
          execution: "main",
          animation: false,
          maxIterations: 900,
          gravity: 0.7,
          nodeRepulsion: 90_000,
          idealEdgeLength: 70,
        }
      : renderer.id === "sigma"
        ? {
            type: "force-atlas2",
            execution: "main",
            animation: false,
            iterations: 90,
            gravity: 1,
            slowDown: 3,
            barnesHutOptimize: true,
          }
        : { ...DEFAULT_VISUALIZATION_POLICY.resultGraph.layout };
  return {
    format: VISUALIZATION_SPEC_FORMAT_V2,
    name: input.name,
    kind: "result-graph",
    result: input.result,
    filters: copyFilters(input.filters),
    renderer,
    graph: {
      layout,
      style: {
        preset: "graphforge-epistemic/v1",
        nodeLabelFields: ["name", "label"],
        nodeLabelFallback: "label-or-id",
        edgeLabelField: "type",
        showEdgeLabels: false,
        nodeSize: 22,
        edgeWidth: 1.3,
        arrowheads: false,
      },
      interactions: { pan: true, zoom: true, select: true, fit: true, relayout: true },
      timebar: { enabled: false },
    },
  };
}

export function createDefaultResultGraphSpec(
  input: TemplateBaseInput,
): ResultGraphVisualizationSpecV2 {
  return createResultGraphSpec(input);
}

export function createDefaultChartSpec(
  input: TemplateBaseInput & {
    mark: ChartMarkV2;
    x: string;
    y: string | null;
    color?: string | null;
    size?: string | null;
    shape?: string | null;
    series?: string | null;
    title?: string | null;
    renderer?: ChartRendererV2["id"];
  },
): ChartVisualizationSpecV2 {
  if (input.color != null && input.series != null) {
    throw new Error("Chart creation accepts either color or series, not both.");
  }
  return {
    format: VISUALIZATION_SPEC_FORMAT_V2,
    name: input.name,
    kind: "chart",
    result: input.result,
    filters: copyFilters(input.filters),
    renderer: input.renderer === "plotly" ? { id: "plotly" } : { ...DEFAULT_VISUALIZATION_POLICY.chart.renderer },
    chart: {
      mark: input.mark,
      bindings: {
        x: input.x,
        y: input.mark === "histogram" ? null : input.y,
        color: input.color ?? null,
        size: input.size ?? null,
        shape: input.shape ?? null,
        series: input.series ?? null,
      },
      aggregation: "none",
      binning: input.mark === "histogram"
        ? { enabled: true, thresholds: 20 }
        : { enabled: false, thresholds: null },
      sort: [],
      axes: { x: true, y: true },
      legend: input.color != null || input.series != null,
      theme: "editor",
      animation: false,
      title: input.title ?? null,
    },
  };
}

export function createDefaultGeospatialSpec(
  input: TemplateBaseInput & {
    source: GeospatialSourceV2;
    sourceCrs: "EPSG:4326";
    projection: "EPSG:3857";
    layers: GeospatialLayerV2[];
    viewport: GeospatialVisualizationSpecV2["geospatial"]["viewport"];
  },
): GeospatialVisualizationSpecV2 {
  if (input.layers.length === 0) {
    throw new Error("Geospatial creation requires at least one layer.");
  }
  if (input.source.type === "coordinates" && input.layers.some((layer) => layer.type !== "point")) {
    throw new Error("Coordinate geospatial sources support point layers only.");
  }
  return {
    format: VISUALIZATION_SPEC_FORMAT_V2,
    name: input.name,
    kind: "geospatial",
    result: input.result,
    filters: copyFilters(input.filters),
    renderer: { ...DEFAULT_VISUALIZATION_POLICY.geospatial.renderer },
    geospatial: {
      source: { ...input.source },
      sourceCrs: input.sourceCrs,
      projection: input.projection,
      aggregation: "none",
      layers: input.layers.map((layer) => ({ ...layer })),
      basemap: { type: "blank" },
      viewport: { ...input.viewport },
      presentation: { title: input.name || null, legend: false, theme: "editor" },
    },
  };
}

export function createDefaultTemporalSpec(
  input: TemplateBaseInput & {
    mark: TemporalVisualizationSpecV2["temporal"]["mark"];
    timestampField: string;
    timezone: string;
    granularity: TemporalVisualizationSpecV2["temporal"]["granularity"];
    valueField: string;
    seriesField?: string | null;
    title?: string | null;
  },
): TemporalVisualizationSpecV2 {
  if (!isTimeZone(input.timezone)) {
    throw new Error(`Temporal timezone ${input.timezone} is not a valid IANA timezone.`);
  }
  return {
    format: VISUALIZATION_SPEC_FORMAT_V2,
    name: input.name,
    kind: "temporal",
    result: input.result,
    filters: copyFilters(input.filters),
    renderer: { ...DEFAULT_VISUALIZATION_POLICY.temporal.renderer },
    temporal: {
      mark: input.mark,
      timestampField: input.timestampField,
      timezone: input.timezone,
      granularity: input.granularity,
      valueField: input.valueField,
      aggregation: "none",
      seriesField: input.seriesField ?? null,
      sort: "ascending",
      range: { start: null, end: null },
      window: { size: null, unit: "point" },
      playback: { enabled: false, step: null, speedMs: null },
      axes: { time: true, value: true },
      legend: input.seriesField != null,
      theme: "editor",
      animation: false,
      title: input.title ?? null,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isIsoTimestampWithOffset(value: unknown): value is string {
  return (
    isNonEmptyString(value) &&
    /(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isTimeZone(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function isSafeString(value: string): boolean {
  return (
    !/^\s*(?:javascript|vbscript|data):/i.test(value) &&
    !/https?:\/\//i.test(value) &&
    !/^\s*\/\//.test(value)
  );
}

function isSafeJsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return isSafeString(value);
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const safe = Array.isArray(value)
    ? value.every((item) => isSafeJsonValue(item, seen))
    : isRecord(value) && Object.values(value).every((item) => isSafeJsonValue(item, seen));
  seen.delete(value);
  return safe;
}

function isOneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === "string" && allowed.includes(value);
}

function isProjectRelativeReference(value: unknown): value is string {
  if (!isNonEmptyString(value) || !isSafeString(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")) return false;
  if (/^(?:[\\/]|[a-z]:[\\/])/i.test(value)) return false;
  return !value.split(/[\\/]+/).some((segment) => segment === "..");
}

function isFilter(value: unknown): value is ResultFilter {
  if (!isRecord(value) || !onlyKeys(value, ["column", "operator", "value"])) return false;
  return (
    isNonEmptyString(value.column) &&
    (value.operator === "equals" || value.operator === "contains") &&
    isNonEmptyString(value.value) &&
    isSafeString(value.value)
  );
}

function isBaseV2(value: Record<string, unknown>, kind: VisualizationKindV2): boolean {
  return (
    value.format === VISUALIZATION_SPEC_FORMAT_V2 &&
    value.kind === kind &&
    isNonEmptyString(value.name) &&
    isSafeString(value.name) &&
    isProjectRelativeReference(value.result) &&
    Array.isArray(value.filters) &&
    value.filters.every(isFilter)
  );
}

function isGraphRenderer(value: unknown): value is GraphRendererV2 {
  if (!isRecord(value) || !onlyKeys(value, ["id", "backend"])) return false;
  return (
    (value.id === "g6" && value.backend === "canvas") ||
    (value.id === "cytoscape" && value.backend === "canvas") ||
    (value.id === "sigma" && value.backend === "webgl")
  );
}

function isGraphLayout(value: unknown, renderer: GraphRendererV2): value is GraphLayoutV2 {
  if (!isRecord(value)) return false;
  if (renderer.id === "g6") {
    return (
      onlyKeys(value, ["type", "execution", "animation", "maxIteration", "barnesHut", "prune", "preventOverlap", "dissuadeHubs", "nodeSize", "nodeSpacing", "kr", "kg", "ks", "ksmax", "tao", "mode"]) &&
      value.type === "force-atlas2" &&
      value.execution === "worker" && value.animation === false &&
      isFiniteNumber(value.maxIteration) && value.maxIteration > 0 &&
      typeof value.barnesHut === "boolean" && typeof value.prune === "boolean" &&
      typeof value.preventOverlap === "boolean" && typeof value.dissuadeHubs === "boolean" &&
      isFiniteNumber(value.nodeSize) && value.nodeSize > 0 &&
      isFiniteNumber(value.nodeSpacing) && value.nodeSpacing >= 0 &&
      ["kr", "kg", "ks", "ksmax", "tao"].every((key) => isFiniteNumber(value[key])) &&
      (value.mode === "normal" || value.mode === "linlog")
    );
  }
  if (renderer.id === "cytoscape") {
    return (
      onlyKeys(value, ["type", "execution", "animation", "maxIterations", "gravity", "nodeRepulsion", "idealEdgeLength"]) &&
      value.type === "cose" && value.execution === "main" &&
      typeof value.animation === "boolean" &&
      isFiniteNumber(value.maxIterations) && value.maxIterations > 0 &&
      isFiniteNumber(value.gravity) && isFiniteNumber(value.nodeRepulsion) &&
      isFiniteNumber(value.idealEdgeLength)
    );
  }
  return (
    onlyKeys(value, ["type", "execution", "animation", "iterations", "gravity", "slowDown", "barnesHutOptimize"]) &&
    value.type === "force-atlas2" && value.execution === "main" && value.animation === false &&
    isFiniteNumber(value.iterations) && value.iterations > 0 &&
    isFiniteNumber(value.gravity) && isFiniteNumber(value.slowDown) &&
    typeof value.barnesHutOptimize === "boolean"
  );
}

function isGraphTimebar(value: unknown): value is GraphTimebarV2 {
  if (!isRecord(value) || typeof value.enabled !== "boolean") return false;
  if (value.enabled === false) return onlyKeys(value, ["enabled"]);
  if (!onlyKeys(value, ["enabled", "nodeTimestampField", "edgeTimestampField", "timezone", "range", "stepMs", "windowMs", "playbackIntervalMs"])) return false;
  const range = value.range;
  return (
    isNullableString(value.nodeTimestampField) && isNullableString(value.edgeTimestampField) &&
    (value.nodeTimestampField !== null || value.edgeTimestampField !== null) &&
    isTimeZone(value.timezone) && isRecord(range) && onlyKeys(range, ["start", "end"]) &&
    isIsoTimestampWithOffset(range.start) && isIsoTimestampWithOffset(range.end) &&
    Date.parse(range.start) <= Date.parse(range.end) &&
    isFiniteNumber(value.stepMs) && value.stepMs > 0 &&
    isFiniteNumber(value.windowMs) && value.windowMs > 0 &&
    isFiniteNumber(value.playbackIntervalMs) && value.playbackIntervalMs > 0
  );
}

function isResultGraphV2(value: Record<string, unknown>): boolean {
  if (!isBaseV2(value, "result-graph") || !onlyKeys(value, ["format", "name", "kind", "result", "filters", "renderer", "graph"])) return false;
  if (!isGraphRenderer(value.renderer) || !isRecord(value.graph) || !onlyKeys(value.graph, ["layout", "style", "interactions", "timebar"])) return false;
  const style = value.graph.style;
  const interactions = value.graph.interactions;
  return (
    isGraphLayout(value.graph.layout, value.renderer) &&
    isRecord(style) && onlyKeys(style, ["preset", "nodeLabelFields", "nodeLabelFallback", "edgeLabelField", "showEdgeLabels", "nodeSize", "edgeWidth", "arrowheads"]) &&
    (style.preset === "graphforge-epistemic/v1" || style.preset === "graphforge-class/v1") &&
    Array.isArray(style.nodeLabelFields) && style.nodeLabelFields.every(isNonEmptyString) &&
    (style.nodeLabelFallback === "label-or-id" || style.nodeLabelFallback === "id") &&
    (style.edgeLabelField === "type" || style.edgeLabelField === null) &&
    typeof style.showEdgeLabels === "boolean" &&
    isFiniteNumber(style.nodeSize) && style.nodeSize > 0 &&
    isFiniteNumber(style.edgeWidth) && style.edgeWidth > 0 &&
    typeof style.arrowheads === "boolean" &&
    isRecord(interactions) && onlyKeys(interactions, ["pan", "zoom", "select", "fit", "relayout"]) &&
    ["pan", "zoom", "select", "fit", "relayout"].every((key) => interactions[key] === true) &&
    isGraphTimebar(value.graph.timebar)
  );
}

function isChartRenderer(value: unknown): value is ChartRendererV2 {
  return isRecord(value) && onlyKeys(value, ["id"]) && (value.id === "g2" || value.id === "plotly");
}

function isSort(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) =>
    isRecord(item) && onlyKeys(item, ["field", "direction"]) && isNonEmptyString(item.field) &&
    (item.direction === "ascending" || item.direction === "descending"));
}

const AGGREGATIONS = new Set(["none", "count", "sum", "average", "minimum", "maximum"]);

function isChartV2(value: Record<string, unknown>): boolean {
  if (!isBaseV2(value, "chart") || !onlyKeys(value, ["format", "name", "kind", "result", "filters", "renderer", "chart"]) || !isChartRenderer(value.renderer) || !isRecord(value.chart)) return false;
  if (!onlyKeys(value.chart, ["mark", "bindings", "aggregation", "binning", "sort", "axes", "legend", "theme", "animation", "title"])) return false;
  const bindings = value.chart.bindings;
  const binning = value.chart.binning;
  const axes = value.chart.axes;
  return (
    isOneOf(value.chart.mark, ["bar", "scatter", "line", "histogram"]) &&
    isRecord(bindings) && onlyKeys(bindings, ["x", "y", "color", "size", "shape", "series"]) &&
    isNonEmptyString(bindings.x) && isNullableString(bindings.y) && isNullableString(bindings.color) &&
    isNullableString(bindings.size) && isNullableString(bindings.shape) && isNullableString(bindings.series) &&
    (value.chart.mark === "histogram" ? bindings.y === null : bindings.y !== null) &&
    typeof value.chart.aggregation === "string" && AGGREGATIONS.has(value.chart.aggregation) &&
    (value.chart.mark !== "histogram" || value.chart.aggregation === "none") &&
    !(bindings.color !== null && bindings.series !== null) &&
    (value.chart.aggregation === "none" || (bindings.size === null && bindings.shape === null)) &&
    isSort(value.chart.sort) &&
    isRecord(binning) && onlyKeys(binning, ["enabled", "thresholds"]) &&
    (value.chart.mark === "histogram"
      ? binning.enabled === true && isFiniteNumber(binning.thresholds) && binning.thresholds > 0
      : binning.enabled === false && binning.thresholds === null) &&
    isRecord(axes) && onlyKeys(axes, ["x", "y"]) && typeof axes.x === "boolean" && typeof axes.y === "boolean" &&
    typeof value.chart.legend === "boolean" && value.chart.theme === "editor" && value.chart.animation === false &&
    (value.chart.title === null || (typeof value.chart.title === "string" && isSafeString(value.chart.title)))
  );
}

function isGeospatialSource(value: unknown): value is GeospatialSourceV2 {
  if (!isRecord(value)) return false;
  if (value.type === "coordinates") {
    return onlyKeys(value, ["type", "longitudeField", "latitudeField"]) && isNonEmptyString(value.longitudeField) && isNonEmptyString(value.latitudeField);
  }
  return value.type === "geojson" && onlyKeys(value, ["type", "geometryField"]) && isNonEmptyString(value.geometryField);
}

function isGeospatialV2(value: Record<string, unknown>): boolean {
  if (!isBaseV2(value, "geospatial") || !onlyKeys(value, ["format", "name", "kind", "result", "filters", "renderer", "geospatial"])) return false;
  if (!isRecord(value.renderer) || !onlyKeys(value.renderer, ["id", "backend"]) || value.renderer.id !== "l7" || value.renderer.backend !== "device" || !isRecord(value.geospatial)) return false;
  if (!onlyKeys(value.geospatial, ["source", "sourceCrs", "projection", "aggregation", "layers", "basemap", "viewport", "presentation"])) return false;
  const basemap = value.geospatial.basemap;
  const viewport = value.geospatial.viewport;
  const presentation = value.geospatial.presentation;
  return (
    isGeospatialSource(value.geospatial.source) && value.geospatial.sourceCrs === "EPSG:4326" && value.geospatial.projection === "EPSG:3857" && value.geospatial.aggregation === "none" &&
    Array.isArray(value.geospatial.layers) && value.geospatial.layers.length > 0 && value.geospatial.layers.every((layer) =>
      isRecord(layer) && onlyKeys(layer, ["id", "type", "colorField", "sizeField", "shapeField", "color", "opacity", "size"]) && isNonEmptyString(layer.id) &&
      isOneOf(layer.type, ["point", "line", "polygon"]) && isNonEmptyString(layer.color) &&
      layer.colorField === null && layer.sizeField === null && layer.shapeField === null &&
      isFiniteNumber(layer.opacity) && layer.opacity >= 0 && layer.opacity <= 1 && isFiniteNumber(layer.size) && layer.size >= 0) &&
    (value.geospatial.source.type !== "coordinates" || value.geospatial.layers.every((layer) => isRecord(layer) && layer.type === "point")) &&
    isRecord(basemap) && basemap.type === "blank" && onlyKeys(basemap, ["type"]) &&
    isRecord(viewport) && onlyKeys(viewport, ["longitude", "latitude", "zoom", "bearing", "pitch", "bounds"]) &&
    ["longitude", "latitude", "zoom", "bearing", "pitch"].every((key) => isFiniteNumber(viewport[key])) &&
    (viewport.longitude as number) >= -180 && (viewport.longitude as number) <= 180 &&
    (viewport.latitude as number) >= -90 && (viewport.latitude as number) <= 90 &&
    (viewport.zoom as number) >= 0 && (viewport.pitch as number) >= 0 && (viewport.pitch as number) <= 85 &&
    viewport.bounds === null &&
    isRecord(presentation) && onlyKeys(presentation, ["title", "legend", "theme"]) &&
    (presentation.title === null || (typeof presentation.title === "string" && isSafeString(presentation.title))) &&
    presentation.legend === false && presentation.theme === "editor"
  );
}

function isTemporalV2(value: Record<string, unknown>): boolean {
  if (!isBaseV2(value, "temporal") || !onlyKeys(value, ["format", "name", "kind", "result", "filters", "renderer", "temporal"]) || !isRecord(value.renderer) || !onlyKeys(value.renderer, ["id"]) || value.renderer.id !== "g2" || !isRecord(value.temporal)) return false;
  if (!onlyKeys(value.temporal, ["mark", "timestampField", "timezone", "granularity", "valueField", "aggregation", "seriesField", "sort", "range", "window", "playback", "axes", "legend", "theme", "animation", "title"])) return false;
  const range = value.temporal.range;
  const window = value.temporal.window;
  const playback = value.temporal.playback;
  const axes = value.temporal.axes;
  return (
    isOneOf(value.temporal.mark, ["line", "bar", "point"]) && isNonEmptyString(value.temporal.timestampField) &&
    isTimeZone(value.temporal.timezone) && isOneOf(value.temporal.granularity, ["millisecond", "second", "minute", "hour", "day", "week", "month", "quarter", "year"]) &&
    isNonEmptyString(value.temporal.valueField) && typeof value.temporal.aggregation === "string" && AGGREGATIONS.has(value.temporal.aggregation) &&
    isNullableString(value.temporal.seriesField) && (value.temporal.sort === "ascending" || value.temporal.sort === "descending") &&
    isRecord(range) && onlyKeys(range, ["start", "end"]) &&
    (range.start === null || isIsoTimestampWithOffset(range.start)) &&
    (range.end === null || isIsoTimestampWithOffset(range.end)) &&
    (range.start === null || range.end === null || Date.parse(range.start) <= Date.parse(range.end)) &&
    isRecord(window) && onlyKeys(window, ["size", "unit"]) && window.size === null && window.unit === "point" &&
    isRecord(playback) && ((playback.enabled === false && onlyKeys(playback, ["enabled", "step", "speedMs"]) && playback.step === null && playback.speedMs === null) ||
      (playback.enabled === true && onlyKeys(playback, ["enabled", "step", "speedMs"]) && Number.isSafeInteger(playback.step) && (playback.step as number) > 0 && isFiniteNumber(playback.speedMs) && playback.speedMs > 0)) &&
    isRecord(axes) && onlyKeys(axes, ["time", "value"]) && typeof axes.time === "boolean" && typeof axes.value === "boolean" &&
    typeof value.temporal.legend === "boolean" && value.temporal.theme === "editor" && value.temporal.animation === false &&
    (value.temporal.title === null || (typeof value.temporal.title === "string" && isSafeString(value.temporal.title)))
  );
}

export function isVisualizationSpecV2(value: unknown): value is ProjectVisualizationSpecV2 {
  if (!isSafeJsonValue(value) || !isRecord(value)) return false;
  if (value.kind === "result-graph") return isResultGraphV2(value);
  if (value.kind === "chart") return isChartV2(value);
  if (value.kind === "geospatial") return isGeospatialV2(value);
  if (value.kind === "temporal") return isTemporalV2(value);
  return false;
}
