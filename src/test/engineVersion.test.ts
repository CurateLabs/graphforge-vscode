import * as assert from "node:assert/strict";
import {
  normalizeEngineVersion,
  npmEngineSpec,
  pypiEngineSpec,
} from "../session/engineVersion";

/**
 * `engineVersion` turns the `graphforge.engineVersion` setting into install
 * specifiers. `latest`/empty must stay unpinned; a concrete version must pin.
 */
suite("engineVersion", () => {
  test("normalizeEngineVersion treats latest/empty/blank/undefined as unpinned", () => {
    assert.equal(normalizeEngineVersion("latest"), undefined);
    assert.equal(normalizeEngineVersion("LATEST"), undefined);
    assert.equal(normalizeEngineVersion(""), undefined);
    assert.equal(normalizeEngineVersion("   "), undefined);
    assert.equal(normalizeEngineVersion(undefined), undefined);
    assert.equal(normalizeEngineVersion(null), undefined);
  });

  test("normalizeEngineVersion trims a concrete version", () => {
    assert.equal(normalizeEngineVersion("0.5.1"), "0.5.1");
    assert.equal(normalizeEngineVersion("  0.5.1  "), "0.5.1");
  });

  test("npmEngineSpec pins a version, else @latest", () => {
    assert.equal(npmEngineSpec("0.5.1"), "@curatelabs/graphforge@0.5.1");
    assert.equal(npmEngineSpec("latest"), "@curatelabs/graphforge@latest");
    assert.equal(npmEngineSpec(""), "@curatelabs/graphforge@latest");
    assert.equal(npmEngineSpec(undefined), "@curatelabs/graphforge@latest");
  });

  test("pypiEngineSpec pins with ==, else bare graphforge", () => {
    assert.equal(pypiEngineSpec("0.5.1"), "graphforge==0.5.1");
    assert.equal(pypiEngineSpec("latest"), "graphforge");
    assert.equal(pypiEngineSpec(""), "graphforge");
    assert.equal(pypiEngineSpec(undefined), "graphforge");
  });
});
