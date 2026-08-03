import * as assert from "node:assert/strict";
import {
  geospatialLinkEndpoints,
  validGeospatialLinkRows,
} from "../webview/geospatialModel";

const source = { longitudeField: "sourceLongitude", latitudeField: "sourceLatitude" };
const target = { longitudeField: "targetLongitude", latitudeField: "targetLatitude" };

suite("geospatial link model", () => {
  test("keeps only rows with two valid geographic endpoints", () => {
    const rows = [
      { sourceLongitude: -84.43, sourceLatitude: 33.64, targetLongitude: -97.67, targetLatitude: 30.2 },
      { sourceLongitude: -84.43, sourceLatitude: 33.64, targetLongitude: 400, targetLatitude: 30.2 },
      { sourceLongitude: -84.43, sourceLatitude: "33.64", targetLongitude: -97.67, targetLatitude: 30.2 },
    ];
    assert.deepEqual(validGeospatialLinkRows(rows, source, target), [rows[0]]);
  });

  test("materializes unique source and target airport nodes", () => {
    const rows = [
      { sourceLongitude: -84.43, sourceLatitude: 33.64, targetLongitude: -97.67, targetLatitude: 30.2 },
      { sourceLongitude: -84.43, sourceLatitude: 33.64, targetLongitude: -71.01, targetLatitude: 42.36 },
    ];
    assert.deepEqual(geospatialLinkEndpoints(rows, source, target), [
      { longitude: -84.43, latitude: 33.64 },
      { longitude: -97.67, latitude: 30.2 },
      { longitude: -71.01, latitude: 42.36 },
    ]);
  });
});
