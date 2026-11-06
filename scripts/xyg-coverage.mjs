import assert from "node:assert/strict";

/** Test-only agreement check. Core supplies contracts; XYG supplies all dispositions. */
export function verifyXygCoverage(contracts, ledger) {
  assert.ok(contracts.length > 0, "Core returned no algorithm contracts");
  assert.ok(ledger.length > 0, "XYG returned no result dispositions");
  for (const contract of contracts) {
    const matches = ledger.filter(row => row.algorithms.includes(contract.algorithm));
    assert.equal(matches.length, 1, `Core ${contract.verb}/${contract.algorithm} needs exactly one XYG disposition`);
    const row = matches[0];
    assert.equal(row.version, contract.resultSchemaVersion, `Core ${contract.algorithm} schema version is not covered by XYG`);
    assert.ok(row.disposition && row.composition && row.intents.length, `XYG ${row.schema} has no explicit composition or table disposition`);
  }
  return { algorithms: contracts.length, schemas: new Set(ledger.map(row => row.schema)).size };
}
