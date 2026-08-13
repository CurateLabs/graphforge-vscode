import * as assert from "node:assert/strict";
import {
  compareVersionsDesc,
  discoverEngineVersions,
  resetVersionDiscoveryCache,
} from "../session/versionDiscovery";

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
    assert.ok(result.versions.includes("0.5.1"));
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
});
