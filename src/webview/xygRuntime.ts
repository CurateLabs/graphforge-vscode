import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import type { ProjectVisualizationSpec } from "../session/visualizationRegistry";
import type { QueryResult } from "../session/types";

let runtime: Promise<any> | undefined;
export function loadXyg(extensionPath: string): Promise<any> {
  return (runtime ??= import(
    /* @vite-ignore */ pathToFileURL(
      path.join(extensionPath, "dist/xyg/node/src/index.js"),
    ).href
  ));
}

export function numericColumn(
  result: QueryResult,
  field: string,
): Float64Array {
  if (!result.columns.includes(field))
    throw new Error(`XYG_FIELD_MISSING: ${field}`);
  return Float64Array.from(result.rows, (row) => {
    let value = row[field];
    if (
      typeof value === "bigint" ||
      (typeof value === "string" && result.numericColumns?.includes(field))
    ) {
      const integer = BigInt(value);
      if (
        integer > BigInt(Number.MAX_SAFE_INTEGER) ||
        integer < BigInt(Number.MIN_SAFE_INTEGER)
      )
        throw new Error(
          `XYG_FIELD_RANGE: ${field} exceeds exact numeric range.`,
        );
      value = Number(integer);
    }
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new Error(
        `XYG_FIELD_TYPE: ${field} requires finite numeric values.`,
      );
    return value;
  });
}

export function graphInput(
  spec: ProjectVisualizationSpec,
  result: QueryResult,
  base?: QueryResult,
  selected: string[] = [],
) {
  if (spec.filters.length)
    throw new Error(
      "XYG_GRAPH_FILTER_REQUIRED: Express graph filters in the Cypher query.",
    );
  if (!result.ipc)
    throw new Error(
      "XYG_ARROW_REQUIRED: Open the source query and run it again to save original Core Arrow results. The JSON result remains available as a table.",
    );
  if (spec.intent) {
    if ((spec.intent === "graph" || base) && !base?.ipc)
      throw new Error(
        "XYG_BASE_REQUIRED: Provide a saved canonical base graph for the analytical layer.",
      );
    if (base && (!base.generationUuid || !result.generationUuid))
      throw new Error(
        "XYG_GENERATION_REQUIRED: Regenerate the base graph and analytical result with generation identity.",
      );
    return {
      ...(base?.ipc ? { base: { tables: [base.ipc], generation: base.generationUuid } } : {}),
      layers: [
        {
          result: result.ipc,
          resultId: graphResultId(spec, result),
          intent: spec.intent,
          generation: result.generationUuid,
        },
      ],
      select: selected,
    };
  }
  return {
    base: { tables: [result.ipc], generation: result.generationUuid },
    select: selected,
  };
}

/** Opaque, bounded XYG identity bound to the source reference, generation and exact Arrow. */
export function graphResultId(spec: ProjectVisualizationSpec, result: QueryResult): string {
  return `result:${createHash("sha256").update(spec.result).update("\0").update(result.generationUuid ?? "").update("\0").update(result.ipc ?? new Uint8Array()).digest("hex")}`;
}

/** Exact Arrow bytes and generation identify an unchanged saved graph source. */
export function sameArrowResult(left?: QueryResult, right?: QueryResult): boolean {
  return left === right || Boolean(left?.ipc && right?.ipc &&
    left.generationUuid === right.generationUuid && Buffer.compare(left.ipc, right.ipc) === 0);
}

/** Explicit field binding only. XYG owns chart geometry, axes, encodings, layout and exports. */
export function composeChart(
  xy: any,
  spec: ProjectVisualizationSpec,
  result: QueryResult,
  width: number,
  height: number,
  theme: string,
): any {
  const fig = xy.figure({ width, height, title: spec.name });
  const chart = spec.chart;
  const temporal = spec.temporal;
  const mark = chart?.mark ?? temporal?.mark;
  const xName = chart?.x ?? temporal!.timestamp;
  const yName = chart?.y ?? temporal?.value;
  const seriesName = chart?.color ?? temporal?.series;
  for (const field of [xName, yName, seriesName].filter(
    (field): field is string => !!field,
  )) {
    if (!result.columns.includes(field))
      throw new Error(`XYG_FIELD_MISSING: ${field}`);
  }
  const categories =
    mark === "bar" &&
    !temporal &&
    result.rows.some(
      (row) =>
        typeof row[xName] === "string" &&
        !result.numericColumns?.includes(xName),
    )
      ? [...new Set(result.rows.map((row) => String(row[xName])))]
      : undefined;
  if (categories)
    fig.setAxis("x", {
      tick_values: categories.map((_, i) => i),
      tick_labels: categories,
    });
  const groups = new Map<string, number[]>();
  result.rows.forEach((row, i) => {
    const name = seriesName ? String(row[seriesName] ?? "") : spec.name;
    const rows = groups.get(name) ?? [];
    rows.push(i);
    groups.set(name, rows);
  });
  for (const [name, rows] of groups) {
    const subset = { ...result, rows: rows.map((i) => result.rows[i]) };
    let x: Float64Array;
    if (temporal) {
      x = Float64Array.from(subset.rows, (row) => {
        const raw = row[xName];
        if (typeof raw !== "string" || !/(?:Z|[+-]\d\d:\d\d)$/.test(raw))
          throw new Error(
            "XYG_TIMEZONE_REQUIRED: timestamps require an explicit UTC offset.",
          );
        const value = Date.parse(raw);
        if (!Number.isFinite(value)) throw new Error("XYG_TIMESTAMP_INVALID");
        return value;
      });
      fig.setAxis("x", { type: "time" });
    } else if (categories) {
      x = Float64Array.from(subset.rows, (row) =>
        categories.indexOf(String(row[xName])),
      );
    } else x = numericColumn(subset, xName);
    const options = { name, tooltip_rows: subset.rows };
    if (mark === "histogram") fig.histogram(x, options);
    else fig[mark!](x, numericColumn(subset, yName!), options);
  }
  fig.interaction = { click: true };
  fig.theme = theme;
  return fig;
}

export function composeMap(
  xy: any,
  spec: ProjectVisualizationSpec,
  result: QueryResult,
  width: number,
  height: number,
): any {
  const geo = spec.geospatial!;
  const lon = numericColumn(result, geo.longitude),
    lat = numericColumn(result, geo.latitude);
  const links = !!geo.targetLongitude;
  const targetLon = links
    ? numericColumn(result, geo.targetLongitude!)
    : undefined;
  const targetLat = links
    ? numericColumn(result, geo.targetLatitude!)
    : undefined;
  const coordinates = new Float64Array(result.rows.length * (links ? 4 : 2));
  const offsets = links ? new Uint32Array(result.rows.length + 1) : undefined;
  for (let i = 0; i < result.rows.length; i++) {
    coordinates[i * (links ? 4 : 2)] = lon[i];
    coordinates[i * (links ? 4 : 2) + 1] = lat[i];
    if (links) {
      coordinates[i * 4 + 2] = targetLon![i];
      coordinates[i * 4 + 3] = targetLat![i];
      offsets![i] = i * 2;
    }
  }
  if (offsets) offsets[result.rows.length] = result.rows.length * 2;
  const source = {
    geometry: links ? 2 : 1,
    crs: geo.crs,
    xy: coordinates,
    validity: new Uint8Array(result.rows.length).fill(1),
    featureIds: BigUint64Array.from(result.rows, (_, i) => BigInt(i)),
    ...(offsets ? { offsets0: offsets } : {}),
  };
  return xy.geoChart(
    xy.geoLayer(links ? "routes" : "points", { source, layerId: 1n }),
    {
      camera: {
        crs: geo.crs,
        worldWrap: true,
        centerX: geo.longitudeCenter,
        centerY: geo.latitudeCenter,
        zoom: geo.zoom,
        width,
        height,
        bearing: 0,
        pitch: 0,
      },
    },
  );
}

/** Validate the same native composition used on open before publishing a saved intent. */
export function validateVisualization(
  xy: any,
  spec: ProjectVisualizationSpec,
  result: QueryResult,
  base?: QueryResult,
): void {
  if (spec.kind === "result-graph") {
    const c = xy.composeGraphForge(graphInput(spec, result, base));
    requireVisualComposition(c);
  }
  else if (spec.kind === "geospatial") composeMap(xy, spec, result, 1100, 650).compile();
  else composeChart(xy, spec, result, 1100, 650, "light").buildPayload();
}

/** XYG decides table-only disposition. A graph panel must not feed it to a layout worker. */
export function requireVisualComposition(composition: { kind: string }): void {
  if (composition.kind === "table")
    throw Object.assign(new Error("XYG_TABLE_ONLY: This composition is table-only. Open the source result in Results, or choose an explicit supported chart intent."), { code: "XYG_TABLE_ONLY" });
}

/** Canonical cell identity wins; scalar cells coordinate with their entire source row. */
export function resultEntitySelection(row: Record<string, unknown>, column?: string) {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, cell] of Object.entries(value)) {
      if (key === "node_uuid" && typeof cell === "string") nodes.add(cell);
      else if (key === "edge_uuid" && typeof cell === "string") edges.add(cell);
      else visit(cell);
    }
  };
  if (column === "node_uuid" && typeof row[column] === "string") nodes.add(row[column]);
  else if (column === "edge_uuid" && typeof row[column] === "string") edges.add(row[column]);
  else if (column) visit(row[column]);
  if (!nodes.size && !edges.size) visit(row);
  return { nodeIds: [...nodes], edgeIds: [...edges] };
}

/** Relay XYG-owned membership, including derived/aggregate edges with no persisted UUID. */
export function resultRowsFromXygPick(identity: any, resultId: string, rowCount: number): number[] {
  const rows = new Set<number>();
  const collect = (pick: any) => {
    for (const member of pick?.layers ?? []) {
      if (member.resultId === resultId && Number.isSafeInteger(member.row) && member.row >= 0 && member.row < rowCount)
        rows.add(member.row);
    }
    // Aggregates carry the native member list, which may be explicitly truncated.
    for (const edge of pick?.edges ?? []) collect(edge);
  };
  collect(identity);
  return [...rows].sort((a, b) => a - b);
}

/** Coordinate a chart hit using XYG's authored trace identity and native result-row map. */
export function resultRowsFromXygChart(figure: any, composition: any, hit: { trace: number; index: number }, rowCount: number): number[] {
  if (!Number.isInteger(hit.trace) || !Number.isInteger(hit.index) || hit.trace < 0 || hit.index < 0) return [];
  const trace = figure?.traces?.[hit.trace];
  if (!trace) return [];
  let row;
  if (composition?.kind === "bar-chart") row = composition.chart.resultRows[hit.index];
  else if (composition?.kind === "parallel-coordinates" || composition?.kind === "scatter") {
    // A parallel-coordinate source row has several rendered segments. The
    // XYG trace's tooltip identity names the UUID for the exact picked segment.
    const id = trace.tooltip_rows?.[hit.index]?.id;
    const source = composition.vectors ?? composition.points;
    const index = typeof id === "string" ? source.uuid.indexOf(id) : -1;
    if (index >= 0) row = source.resultRows[index];
  }
  return Number.isSafeInteger(row) && row >= 0 && row < rowCount ? [row] : [];
}

/** Select only persisted UUIDs belonging to XYG's source-row membership. */
export function resultEntitiesFromXygRow(composition: any, resultId: string, row: number) {
  const nodes = new Set<string>(), edges = new Set<string>();
  if (composition?.kind !== "graph" || !Number.isSafeInteger(row) || row < 0)
    return { nodeIds: [], edgeIds: [] };
  for (const kind of ["node", "edge"] as const) {
    const count = kind === "node" ? composition.nodes.count : composition.edges.count;
    for (let index = 0; index < count; index++) {
      const identity = composition.identify(kind, index);
      if (!identity.layers.some((member: { resultId: string; row: number }) => member.resultId === resultId && member.row === row)) continue;
      if (identity.uuid) (kind === "node" ? nodes : edges).add(identity.uuid);
      else if (kind === "edge") {
        // A derived relationship has no persisted UUID. Its native endpoints
        // may be selected; never synthesize a relationship identity.
        if (identity.source) nodes.add(identity.source);
        if (identity.target) nodes.add(identity.target);
      }
    }
  }
  return { nodeIds: [...nodes], edgeIds: [...edges] };
}
