import { Chart } from "@antv/g2";
import { LineLayer, PointLayer, PolygonLayer, Scene } from "@antv/l7";
import { Map as L7Map } from "@antv/l7-maps/simple";
import type { TableRow } from "../../../src/session/types";
import type {
  ChartVisualizationSpecV2,
  GeospatialVisualizationSpecV2,
  TemporalVisualizationSpecV2,
} from "../../../src/session/visualizationRegistry";
import type {
  ArtifactVisualizationHostToWebview,
  ArtifactVisualizationSpec,
  ArtifactVisualizationWebviewToHost,
} from "../../../src/webview/artifactVisualizationProtocol";
import "./artifactVisualization.css";

const vscode = acquireVsCodeApi();
const titleElement = document.getElementById("title");
const metaElement = document.getElementById("meta");
const bannerElement = document.getElementById("banner");
const container = document.getElementById("visualization");
const saveButton = document.getElementById("save") as HTMLButtonElement | null;
const revertButton = document.getElementById("revert") as HTMLButtonElement | null;
const temporalControls = document.getElementById("temporal-controls") as HTMLElement | null;
const rangeStart = document.getElementById("range-start") as HTMLInputElement | null;
const rangeEnd = document.getElementById("range-end") as HTMLInputElement | null;
const playButton = document.getElementById("play") as HTMLButtonElement | null;
const pauseButton = document.getElementById("pause") as HTMLButtonElement | null;
const summaryElement = document.getElementById("summary");
const tableWrap = document.getElementById("table-wrap");

let currentPath = "";
let currentSpec: ArtifactVisualizationSpec | undefined;
let currentRows: TableRow[] = [];
let currentColumns: string[] = [];
let chart: Chart | undefined;
let scene: Scene | undefined;
let playbackTimer: number | undefined;
let playbackUpdateInProgress = false;
let viewportTimer: number | undefined;
let renderToken = 0;

const MAP_SCENE_LOAD_TIMEOUT_MS = 15_000;
const VIEWPORT_SAVE_DEBOUNCE_MS = 200;

function post(message: ArtifactVisualizationWebviewToHost): void {
  vscode.postMessage(message);
}

function showBanner(message?: string): void {
  if (!bannerElement) return;
  bannerElement.hidden = !message;
  bannerElement.textContent = message ?? "";
}

function setDirty(dirty: boolean): void {
  if (saveButton) saveButton.disabled = !dirty;
  if (revertButton) revertButton.disabled = !dirty;
  if (metaElement && currentSpec) {
    metaElement.textContent = `${currentSpec.kind} · ${currentSpec.renderer.id} · ${currentPath}${dirty ? " · unsaved changes" : ""}`;
  }
}

function stopPlayback(): void {
  if (playbackTimer !== undefined) {
    window.clearInterval(playbackTimer);
    playbackTimer = undefined;
  }
  playbackUpdateInProgress = false;
}

function destroyRenderer(): void {
  if (viewportTimer !== undefined) {
    window.clearTimeout(viewportTimer);
    viewportTimer = undefined;
  }
  chart?.destroy();
  chart = undefined;
  scene?.destroy();
  scene = undefined;
  container?.replaceChildren();
}

function valueText(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value === "object") {
    try { return JSON.stringify(value); } catch { return "[unserializable]"; }
  }
  return String(value);
}

function renderAccessibleTable(spec: ArtifactVisualizationSpec, columns: string[], rows: TableRow[]): void {
  const displayed = rows.slice(0, 100);
  if (summaryElement) {
    summaryElement.textContent = `${spec.name}: showing ${displayed.length} of ${rows.length} result row(s); ${columns.length} column(s)`;
  }
  if (!tableWrap) return;
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headerRow = document.createElement("tr");
  for (const column of columns) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = column;
    headerRow.appendChild(cell);
  }
  head.appendChild(headerRow);
  table.appendChild(head);
  const body = document.createElement("tbody");
  displayed.forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
    tr.tabIndex = 0;
    tr.setAttribute("aria-label", `Select row ${rowIndex + 1}`);
    const select = () => post({ type: "graphforge/selectResult", rowIndex });
    tr.addEventListener("click", select);
    tr.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      select();
    });
    for (const column of columns) {
      const cell = document.createElement("td");
      cell.textContent = valueText(row[column]);
      tr.appendChild(cell);
    }
    body.appendChild(tr);
  });
  table.appendChild(body);
  tableWrap.replaceChildren(table);
}

function numeric(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function compareValues(left: unknown, right: unknown): number {
  const leftNumber = numeric(left);
  const rightNumber = numeric(right);
  if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber - rightNumber;
  return String(left ?? "").localeCompare(String(right ?? ""));
}

function sortRows(rows: TableRow[], sort: Array<{ field: string; direction: "ascending" | "descending" }>): TableRow[] {
  return [...rows].sort((left, right) => {
    for (const item of sort) {
      const compared = compareValues(left[item.field], right[item.field]);
      if (compared !== 0) return item.direction === "ascending" ? compared : -compared;
    }
    return 0;
  });
}

function aggregateRows(
  rows: TableRow[],
  x: string,
  y: string | null,
  series: string | null,
  aggregation: ChartVisualizationSpecV2["chart"]["aggregation"],
): TableRow[] {
  if (aggregation === "none") return rows.map((row) => ({ ...row }));
  const groups = new globalThis.Map<string, TableRow[]>();
  for (const row of rows) {
    const key = JSON.stringify([row[x], series ? row[series] : null]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const first = group[0] ?? {};
    const values = y ? group.map((row) => numeric(row[y])).filter((value): value is number => value !== undefined) : [];
    let aggregated: number;
    switch (aggregation) {
      case "count": aggregated = group.length; break;
      case "sum": aggregated = values.reduce((total, value) => total + value, 0); break;
      case "average": aggregated = values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0; break;
      case "minimum": aggregated = values.length ? Math.min(...values) : 0; break;
      case "maximum": aggregated = values.length ? Math.max(...values) : 0; break;
      default: aggregated = 0;
    }
    return { [x]: first[x], ...(series ? { [series]: first[series] } : {}), ...(y ? { [y]: aggregated } : { __count: aggregated }) };
  });
}

function g2Mark(mark: ChartVisualizationSpecV2["chart"]["mark"] | TemporalVisualizationSpecV2["temporal"]["mark"]): string {
  if (mark === "bar") return "interval";
  if (mark === "scatter" || mark === "point") return "point";
  if (mark === "histogram") return "rectY";
  return "line";
}

async function renderChart(spec: ChartVisualizationSpecV2, rows: TableRow[]): Promise<void> {
  if (!container) throw new Error("Visualization container missing");
  if (spec.renderer.id === "plotly") {
    throw new Error("Plotly v2 chart artifacts use the retained Figure adapter; this panel only renders G2.");
  }
  const bindings = spec.chart.bindings;
  const series = bindings.series ?? bindings.color;
  const aggregated = aggregateRows(rows, bindings.x, bindings.y, series, spec.chart.aggregation);
  if (aggregated.length > 0) {
    const unavailable = spec.chart.sort
      .map((item) => item.field)
      .filter((field) => !Object.hasOwn(aggregated[0], field));
    if (unavailable.length > 0) {
      throw new Error(`Chart sort field(s) are unavailable after aggregation: ${[...new Set(unavailable)].join(", ")}.`);
    }
  }
  const prepared = sortRows(aggregated, spec.chart.sort);
  const encode: Record<string, string> = { x: bindings.x };
  if (bindings.y) encode.y = bindings.y;
  if (bindings.color) encode.color = bindings.color;
  if (bindings.size) encode.size = bindings.size;
  if (bindings.shape) encode.shape = bindings.shape;
  if (bindings.series && !encode.color) encode.color = bindings.series;
  const options: Record<string, unknown> = {
    type: g2Mark(spec.chart.mark),
    data: { type: "inline", value: prepared },
    encode,
    axis: { x: spec.chart.axes.x ? {} : false, y: spec.chart.axes.y ? {} : false },
    legend: spec.chart.legend ? {} : false,
    animate: spec.chart.animation,
  };
  if (spec.chart.mark === "histogram") {
    options.transform = [{ type: "binX", y: "count", thresholds: spec.chart.binning.thresholds }];
    options.encode = { x: bindings.x, y: "count" };
  }
  if (spec.chart.title) options.title = spec.chart.title;
  chart = new Chart({ container, autoFit: true });
  chart.options(options as never);
  await chart.render();
}

function temporalBucket(value: unknown, spec: TemporalVisualizationSpecV2): string | undefined {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return undefined;
  const temporal = spec.temporal;
  const options: Intl.DateTimeFormatOptions = { timeZone: temporal.timezone, year: "numeric" };
  if (["quarter", "month", "week", "day", "hour", "minute", "second", "millisecond"].includes(temporal.granularity)) options.month = "2-digit";
  if (["week", "day", "hour", "minute", "second", "millisecond"].includes(temporal.granularity)) options.day = "2-digit";
  if (["hour", "minute", "second", "millisecond"].includes(temporal.granularity)) {
    options.hour = "2-digit";
    options.hourCycle = "h23";
  }
  if (["minute", "second", "millisecond"].includes(temporal.granularity)) options.minute = "2-digit";
  if (["second", "millisecond"].includes(temporal.granularity)) options.second = "2-digit";
  if (temporal.granularity === "millisecond") options.fractionalSecondDigits = 3;
  const parts = new Intl.DateTimeFormat("en-CA", options).formatToParts(date);
  const record = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (temporal.granularity === "quarter") {
    return `${record.year}-Q${Math.floor((Number(record.month) - 1) / 3) + 1}`;
  }
  if (temporal.granularity === "week") {
    const zoned = new Date(Date.UTC(Number(record.year), Number(record.month) - 1, Number(record.day)));
    const weekday = zoned.getUTCDay() || 7;
    zoned.setUTCDate(zoned.getUTCDate() + 4 - weekday);
    const weekYear = zoned.getUTCFullYear();
    const yearStart = new Date(Date.UTC(weekYear, 0, 1));
    const week = Math.ceil((((zoned.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
    return `${weekYear}-W${String(week).padStart(2, "0")}`;
  }
  return [record.year, record.month, record.day, record.hour, record.minute, record.second, record.fractionalSecond]
    .filter((part) => part !== undefined)
    .join("-");
}

function temporalRows(spec: TemporalVisualizationSpecV2, rows: TableRow[]): TableRow[] {
  const { timestampField, range, sort } = spec.temporal;
  const start = range.start ? Date.parse(range.start) : Number.NEGATIVE_INFINITY;
  const end = range.end ? Date.parse(range.end) : Number.POSITIVE_INFINITY;
  const prepared: TableRow[] = rows.flatMap((row): TableRow[] => {
    const timestamp = Date.parse(String(row[timestampField]));
    if (!Number.isFinite(timestamp) || timestamp < start || timestamp > end) return [];
    const bucket = temporalBucket(row[timestampField], spec);
    return bucket ? [{ ...row, __graphforgeTimeBucket: bucket }] : [];
  });
  return prepared.sort((left, right) => {
    const compared = compareValues(left[timestampField], right[timestampField]);
    return sort === "ascending" ? compared : -compared;
  });
}

function preparedTemporalRows(spec: TemporalVisualizationSpecV2, rows: TableRow[]): TableRow[] {
  const bucketed = temporalRows(spec, rows);
  const { temporal } = spec;
  return aggregateRows(
    bucketed,
    "__graphforgeTimeBucket",
    temporal.valueField,
    temporal.seriesField,
    temporal.aggregation,
  ).sort((left, right) => {
    const compared = compareValues(left.__graphforgeTimeBucket, right.__graphforgeTimeBucket);
    return temporal.sort === "ascending" ? compared : -compared;
  });
}

async function renderTemporal(spec: TemporalVisualizationSpecV2, rows: TableRow[]): Promise<void> {
  if (!container) throw new Error("Visualization container missing");
  const prepared = preparedTemporalRows(spec, rows);
  const { temporal } = spec;
  const encode: Record<string, string> = { x: "__graphforgeTimeBucket", y: temporal.valueField };
  if (temporal.seriesField) encode.color = temporal.seriesField;
  chart = new Chart({ container, autoFit: true });
  chart.options({
    type: g2Mark(temporal.mark),
    data: { type: "inline", value: prepared },
    encode,
    axis: { x: temporal.axes.time ? {} : false, y: temporal.axes.value ? {} : false },
    legend: temporal.legend ? {} : false,
    animate: temporal.animation,
    ...(temporal.title ? { title: temporal.title } : {}),
  } as never);
  await chart.render();
  if (rangeStart) rangeStart.value = temporal.range.start ?? "";
  if (rangeEnd) rangeEnd.value = temporal.range.end ?? "";
  if (temporalControls) temporalControls.hidden = false;
}

function featureCollection(spec: GeospatialVisualizationSpecV2, rows: TableRow[]): GeoJSON.FeatureCollection {
  const source = spec.geospatial.source;
  if (source.type !== "geojson") throw new Error("Line and polygon layers require an explicit GeoJSON geometry field.");
  const features = rows.flatMap((row) => {
    const geometry = row[source.geometryField];
    if (!geometry || typeof geometry !== "object" || !("type" in geometry)) return [];
    return [{ type: "Feature" as const, geometry: geometry as GeoJSON.Geometry, properties: { ...row, [source.geometryField]: undefined } }];
  });
  return { type: "FeatureCollection", features };
}

async function renderGeospatial(spec: GeospatialVisualizationSpecV2, rows: TableRow[]): Promise<void> {
  if (!container) throw new Error("Visualization container missing");
  const viewport = spec.geospatial.viewport;
  const nextScene = new Scene({
    id: container as HTMLDivElement,
    renderer: spec.renderer.backend,
    logoVisible: false,
    map: new L7Map({
      center: [viewport.longitude, viewport.latitude],
      zoom: viewport.zoom,
      pitch: viewport.pitch,
      rotation: viewport.bearing,
    }),
  });
  scene = nextScene;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      nextScene.destroy();
      if (scene === nextScene) scene = undefined;
      reject(new Error(`The map scene did not load within ${MAP_SCENE_LOAD_TIMEOUT_MS} ms.`));
    }, MAP_SCENE_LOAD_TIMEOUT_MS);
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      callback();
    };
    const onError = (error: unknown) => finish(() => {
      nextScene.destroy();
      if (scene === nextScene) scene = undefined;
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    nextScene.once("loaded", () => {
      if (settled) return;
      try {
        for (const layerSpec of spec.geospatial.layers) {
          if (layerSpec.type === "point") {
            const layer = new PointLayer({ name: layerSpec.id });
            if (spec.geospatial.source.type === "coordinates") {
              layer.source(rows, { parser: { type: "json", x: spec.geospatial.source.longitudeField, y: spec.geospatial.source.latitudeField } });
            } else {
              layer.source(featureCollection(spec, rows));
            }
            layer.shape("circle").size(layerSpec.size).color(layerSpec.color).style({ opacity: layerSpec.opacity });
            nextScene.addLayer(layer);
          } else if (layerSpec.type === "line") {
            const layer = new LineLayer({ name: layerSpec.id })
              .source(featureCollection(spec, rows))
              .shape("line")
              .size(layerSpec.size)
              .color(layerSpec.color)
              .style({ opacity: layerSpec.opacity });
            nextScene.addLayer(layer);
          } else {
            const layer = new PolygonLayer({ name: layerSpec.id })
              .source(featureCollection(spec, rows))
              .shape("fill")
              .color(layerSpec.color)
              .style({ opacity: layerSpec.opacity });
            nextScene.addLayer(layer);
          }
        }
        nextScene.on("mapmove", scheduleViewportProposal);
        nextScene.on("zoomchange", scheduleViewportProposal);
        finish(resolve);
      } catch (error) {
        finish(() => reject(error));
      }
    });
    nextScene.once("error", onError);
  });
}

function scheduleViewportProposal(): void {
  if (viewportTimer !== undefined) window.clearTimeout(viewportTimer);
  viewportTimer = window.setTimeout(() => {
    viewportTimer = undefined;
    proposeViewport();
  }, VIEWPORT_SAVE_DEBOUNCE_MS);
}

function proposeViewport(): void {
  if (!scene || currentSpec?.kind !== "geospatial") return;
  const center = scene.getCenter();
  const spec: GeospatialVisualizationSpecV2 = {
    ...currentSpec,
    geospatial: {
      ...currentSpec.geospatial,
      viewport: {
        longitude: center.lng,
        latitude: center.lat,
        zoom: scene.getZoom(),
        bearing: scene.getRotation(),
        pitch: scene.getPitch(),
        bounds: currentSpec.geospatial.viewport.bounds,
      },
    },
  };
  currentSpec = spec;
  post({ type: "graphforge/artifactStateChanged", spec });
}

async function render(spec: ArtifactVisualizationSpec, rows: TableRow[]): Promise<void> {
  const token = ++renderToken;
  const started = performance.now();
  post({ type: "graphforge/renderStarted", kind: spec.kind, renderer: spec.renderer.id });
  destroyRenderer();
  showBanner();
  if (temporalControls) temporalControls.hidden = spec.kind !== "temporal";
  try {
    if (spec.kind === "chart") await renderChart(spec, rows);
    else if (spec.kind === "temporal") await renderTemporal(spec, rows);
    else await renderGeospatial(spec, rows);
    if (token !== renderToken) return;
    post({
      type: "graphforge/renderReady",
      kind: spec.kind,
      renderer: spec.renderer.id,
      rowCount: rows.length,
      durationMs: performance.now() - started,
    });
  } catch (error) {
    if (token !== renderToken) return;
    const message = error instanceof Error ? error.message : String(error);
    showBanner(`Could not render ${spec.kind}: ${message}`);
    post({
      type: "graphforge/renderFailed",
      kind: spec.kind,
      renderer: spec.renderer.id,
      phase: "render",
      code: `${spec.renderer.id.toUpperCase()}_RENDER_FAILED`,
      message,
    });
  }
}

function updateTemporalRange(): void {
  if (currentSpec?.kind !== "temporal") return;
  stopPlayback();
  const start = rangeStart?.value.trim() || null;
  const end = rangeEnd?.value.trim() || null;
  if ((start && !Number.isFinite(Date.parse(start))) || (end && !Number.isFinite(Date.parse(end)))) {
    showBanner("Temporal ranges must use ISO 8601 timestamps.");
    return;
  }
  currentSpec = { ...currentSpec, temporal: { ...currentSpec.temporal, range: { start, end } } };
  post({ type: "graphforge/artifactStateChanged", spec: currentSpec });
  void render(currentSpec, currentRows);
}

function startPlayback(): void {
  stopPlayback();
  if (currentSpec?.kind !== "temporal" || !currentSpec.temporal.playback.enabled) {
    showBanner("Enable playback explicitly in the temporal artifact before playing.");
    return;
  }
  const timestamps = currentRows
    .map((row) => Date.parse(String(row[currentSpec!.kind === "temporal" ? currentSpec!.temporal.timestampField : ""])))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!timestamps.length) return;
  let index = 0;
  playbackTimer = window.setInterval(() => {
    if (playbackUpdateInProgress) return;
    if (currentSpec?.kind !== "temporal") return stopPlayback();
    playbackUpdateInProgress = true;
    const playbackSpec = currentSpec;
    const step = playbackSpec.temporal.playback.enabled ? playbackSpec.temporal.playback.step : 1;
    index = Math.min(index + step, timestamps.length - 1);
    const end = new Date(timestamps[index]).toISOString();
    currentSpec = { ...playbackSpec, temporal: { ...playbackSpec.temporal, range: { ...playbackSpec.temporal.range, end } } };
    const nextSpec = currentSpec;
    if (rangeEnd) rangeEnd.value = end;
    post({ type: "graphforge/artifactStateChanged", spec: nextSpec });
    const activeChart = chart;
    void activeChart?.changeData({ type: "inline", value: preparedTemporalRows(nextSpec, currentRows) } as never)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        showBanner(`Could not update temporal playback: ${message}`);
        post({
          type: "graphforge/renderFailed",
          kind: "temporal",
          renderer: nextSpec.renderer.id,
          phase: "render",
          code: "G2_PLAYBACK_UPDATE_FAILED",
          message,
        });
        stopPlayback();
      })
      .finally(() => {
        playbackUpdateInProgress = false;
        if (index >= timestamps.length - 1) stopPlayback();
      });
  }, currentSpec.temporal.playback.speedMs);
}

saveButton?.addEventListener("click", () => post({ type: "graphforge/saveArtifactState" }));
revertButton?.addEventListener("click", () => post({ type: "graphforge/revertArtifactState" }));
rangeStart?.addEventListener("change", updateTemporalRange);
rangeEnd?.addEventListener("change", updateTemporalRange);
playButton?.addEventListener("click", startPlayback);
pauseButton?.addEventListener("click", stopPlayback);

window.addEventListener("message", (event: MessageEvent<ArtifactVisualizationHostToWebview>) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;
  if (message.type === "graphforge/artifactError") {
    showBanner(message.message);
    return;
  }
  if (message.type === "graphforge/artifactDirty") {
    setDirty(message.dirty);
    return;
  }
  if (message.type === "graphforge/artifactCommitted") {
    currentSpec = message.spec;
    setDirty(false);
    showBanner();
    return;
  }
  if (message.type === "graphforge/artifactReverted") {
    currentSpec = message.spec;
    stopPlayback();
    setDirty(false);
    showBanner();
    void render(currentSpec, currentRows);
    return;
  }
  if (message.type === "graphforge/artifactVisualization") {
    currentPath = message.path;
    stopPlayback();
    currentSpec = message.spec;
    currentRows = message.result.rows;
    currentColumns = message.result.columns;
    if (titleElement) {
      titleElement.textContent = message.spec.kind === "geospatial"
        ? message.spec.geospatial.presentation.title ?? message.spec.name
        : message.spec.name;
    }
    setDirty(message.dirty);
    renderAccessibleTable(message.spec, currentColumns, currentRows);
    void render(message.spec, currentRows);
  }
});

window.addEventListener("resize", () => chart?.forceFit());
post({ type: "graphforge/ready" });
