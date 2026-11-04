import * as path from "node:path";
import { pathToFileURL } from "node:url";
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
  if (!result.ipc)
    throw new Error(
      "XYG_ARROW_REQUIRED: Run the query again to save original Core Arrow results.",
    );
  if (spec.filters.length)
    throw new Error(
      "XYG_GRAPH_FILTER_REQUIRED: Express graph filters in the Cypher query.",
    );
  if (spec.intent) {
    if (!base?.ipc)
      throw new Error(
        "XYG_BASE_REQUIRED: Provide a saved canonical base graph for the analytical layer.",
      );
    if (!base.generationUuid || !result.generationUuid)
      throw new Error(
        "XYG_GENERATION_REQUIRED: Regenerate the base graph and analytical result with generation identity.",
      );
    return {
      base: { tables: [base.ipc], generation: base.generationUuid },
      layers: [
        {
          result: result.ipc,
          intent: spec.intent,
          generation: result.generationUuid,
        },
      ],
      select: selected,
    };
  }
  return { base: { tables: [result.ipc] }, select: selected };
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
      fig.setAxis("x", { scale: "time" });
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
