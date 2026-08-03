import type { GeospatialCoordinateBindingV2 } from "../session/visualizationRegistry";
import type { TableRow } from "../session/types";

export interface GeospatialEndpointRow {
  longitude: number;
  latitude: number;
}

function coordinate(
  row: TableRow,
  binding: GeospatialCoordinateBindingV2,
): GeospatialEndpointRow | undefined {
  const longitude = row[binding.longitudeField];
  const latitude = row[binding.latitudeField];
  if (typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return undefined;
  }
  if (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return undefined;
  }
  return { longitude, latitude };
}

export function validGeospatialLinkRows(
  rows: TableRow[],
  source: GeospatialCoordinateBindingV2,
  target: GeospatialCoordinateBindingV2,
): TableRow[] {
  return rows.filter((row) => coordinate(row, source) !== undefined && coordinate(row, target) !== undefined);
}

export function geospatialLinkEndpoints(
  rows: TableRow[],
  source: GeospatialCoordinateBindingV2,
  target: GeospatialCoordinateBindingV2,
): GeospatialEndpointRow[] {
  const endpoints = new Map<string, GeospatialEndpointRow>();
  for (const row of rows) {
    for (const binding of [source, target]) {
      const endpoint = coordinate(row, binding);
      if (!endpoint) continue;
      endpoints.set(`${endpoint.longitude}\u0000${endpoint.latitude}`, endpoint);
    }
  }
  return [...endpoints.values()];
}
