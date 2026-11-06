import assert from "node:assert/strict";
import test from "node:test";
import { verifyXygCoverage } from "./xyg-coverage.mjs";

const contracts = [{ verb: "rank", algorithm: "score", resultSchemaVersion: 1 }];
const ledger = [{ schema: "node-score", version: 1, algorithms: ["score"], disposition: "node-layer", composition: "node-score", intents: ["graph"] }];
test("coverage fails when Core introduces an unmapped algorithm", () => {
  assert.throws(() => verifyXygCoverage([...contracts, { ...contracts[0], algorithm: "new-algorithm" }], ledger), /new-algorithm/);
});
test("coverage fails when Core changes a schema version or XYG has ambiguous ownership", () => {
  assert.throws(() => verifyXygCoverage([{ ...contracts[0], resultSchemaVersion: 2 }], ledger), /schema version/);
  assert.throws(() => verifyXygCoverage(contracts, [...ledger, ...ledger]), /exactly one/);
  assert.throws(() => verifyXygCoverage(contracts, [{ ...ledger[0], intents: [] }]), /explicit composition/);
  assert.deepEqual(verifyXygCoverage(contracts, ledger), { algorithms: 1, schemas: 1 });
});
