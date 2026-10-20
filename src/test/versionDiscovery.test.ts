import * as assert from "node:assert/strict";
import {
  compareVersionsDesc,
  discoverEngineVersions,
  fallbackVersions,
  resetVersionDiscoveryCache,
  versionChoices,
} from "../session/versionDiscovery";
import { QUALIFIED_CORE } from "../session/coreQualification";

const DECL = { range: ">=0.6.0-rc.5 <0.7.0", refuseBelow: "0.5.1" };

/**
 * `versionDiscovery` fetches installable versions from npm/PyPI for the Setup
 * wizards. It must parse both registry shapes, sort newest-first, and — most
 * importantly — never dead-end: any failure falls back to a static list. Tests
 * inject `fetchImpl`/`now` so nothing here touches the network.
 */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

suite("versionDiscovery", () => {
  test("compareVersionsDesc orders newest-first with numeric segments", () => {
    const sorted = ["0.4.0", "0.5.1", "0.5.0", "0.10.0"].sort(compareVersionsDesc);
    assert.deepEqual(sorted, ["0.10.0", "0.5.1", "0.5.0", "0.4.0"]);
  });

  test("npm discovery parses versions + dist-tags.latest, sorted desc", async () => {
    resetVersionDiscoveryCache();
    const fetchImpl = (async () =>
      jsonResponse({
        versions: { "0.5.0": {}, "0.5.1": {} },
        "dist-tags": { latest: "0.5.1" },
      })) as unknown as typeof fetch;
    const result = await discoverEngineVersions("npm", { fetchImpl });
    assert.equal(result.source, "network");
    assert.equal(result.latest, "0.5.1");
    assert.deepEqual(result.versions, ["0.5.1", "0.5.0"]);
  });

  test("pypi discovery parses releases + info.version", async () => {
    resetVersionDiscoveryCache();
    const fetchImpl = (async () =>
      jsonResponse({
        releases: { "0.5.0": [], "0.5.1": [] },
        info: { version: "0.5.1" },
      })) as unknown as typeof fetch;
    const result = await discoverEngineVersions("pypi", { fetchImpl });
    assert.equal(result.source, "network");
    assert.equal(result.latest, "0.5.1");
    assert.deepEqual(result.versions, ["0.5.1", "0.5.0"]);
  });

  test("falls back to a static list when fetch throws (never dead-ends)", async () => {
    resetVersionDiscoveryCache();
    const fetchImpl = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const result = await discoverEngineVersions("npm", { fetchImpl });
    assert.equal(result.source, "fallback");
    assert.deepEqual(result.versions, fallbackVersions("npm"));
    assert.equal(result.latest, undefined, "the registry's latest tag is unknown offline");
    assert.ok(result.note && result.note.length > 0, "fallback must carry a note for the picker");
  });

  test("falls back on a non-ok HTTP response", async () => {
    resetVersionDiscoveryCache();
    const fetchImpl = (async () => jsonResponse({}, false, 503)) as unknown as typeof fetch;
    const result = await discoverEngineVersions("npm", { fetchImpl });
    assert.equal(result.source, "fallback");
  });

  test("caches within the TTL — a second call does not re-fetch", async () => {
    resetVersionDiscoveryCache();
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return jsonResponse({ versions: { "0.5.1": {} }, "dist-tags": { latest: "0.5.1" } });
    }) as unknown as typeof fetch;
    const opts = { fetchImpl, now: () => 1000 };
    await discoverEngineVersions("npm", opts);
    await discoverEngineVersions("npm", opts);
    assert.equal(calls, 1);
  });

  test("compareVersionsDesc uses semver precedence for npm and PEP 440 pre-releases", () => {
    assert.deepEqual(
      ["0.5.2", "0.6.0-rc.4", "0.6.0", "0.6.0-rc.5"].sort(compareVersionsDesc),
      ["0.6.0", "0.6.0-rc.5", "0.6.0-rc.4", "0.5.2"],
    );
    assert.deepEqual(["0.5.2", "0.6.0rc5", "0.6.0rc10"].sort(compareVersionsDesc), ["0.6.0rc10", "0.6.0rc5", "0.5.2"]);
  });

  test("fallback derives from the qualified range, spelled per registry", () => {
    assert.deepEqual(fallbackVersions("npm", DECL), ["0.6.0-rc.5"]);
    assert.deepEqual(fallbackVersions("pypi", DECL), ["0.6.0rc5"]);
    assert.deepEqual(fallbackVersions("npm", { range: ">=0.7.0 <0.8.0", refuseBelow: "0.6.0" }), ["0.7.0"]);
  });

  test("the shipped declaration yields a qualified fallback for both registries", () => {
    for (const target of ["npm", "pypi"] as const) {
      const choices = versionChoices({ versions: fallbackVersions(target), source: "fallback" }, QUALIFIED_CORE);
      assert.ok(choices.recommended, `${target} fallback must be inside ${QUALIFIED_CORE.range}`);
    }
  });

  test("versionChoices recommends the newest qualified version when latest is not qualified", () => {
    // The real registries on 2026-10-20: latest is 0.5.2, the 0.6 candidates are pre-releases.
    const npm = versionChoices(
      { latest: "0.5.2", versions: ["0.6.0-rc.5", "0.6.0-rc.4", "0.5.2", "0.5.1", "0.5.0"], source: "network" },
      DECL,
    );
    assert.equal(npm.recommended, "0.6.0-rc.5");
    assert.equal(npm.latestStatus, "unqualified");
    assert.deepEqual(
      npm.choices.map((c) => [c.version, c.status, c.isLatest]),
      [
        ["0.6.0-rc.5", "qualified", false],
        ["0.6.0-rc.4", "unqualified", false],
        ["0.5.2", "unqualified", true],
        ["0.5.1", "unqualified", false],
      ],
    );
    assert.equal(npm.hidden, 1, "0.5.0 is below refuseBelow and hidden");

    const pypi = versionChoices({ latest: "0.5.2", versions: ["0.6.0rc5", "0.6.0rc4", "0.5.2"], source: "network" }, DECL);
    assert.equal(pypi.recommended, "0.6.0rc5");
  });

  test("versionChoices has no recommendation when nothing is qualified", () => {
    const result = versionChoices({ latest: "0.5.2", versions: ["0.5.2"], source: "network" }, DECL);
    assert.equal(result.recommended, undefined);
    assert.equal(result.choices.length, 1);
  });
});
