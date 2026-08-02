import * as assert from "node:assert/strict";
import {
  GRAPHFORGE_MODULE_FORMAT,
  ModuleManifestError,
  moduleContextKey,
  parseModuleManifest,
} from "../modules/moduleManifest";

suite("module manifest", () => {
  test("parses command and GraphForge-owned entrypoints", () => {
    const base = {
      format: GRAPHFORGE_MODULE_FORMAT,
      id: "acme.routes",
      name: "Routes",
      version: "1.2.3",
      publisher: "Acme",
      description: "Route analysis tools.",
      capabilities: ["query", "visualize"],
    };
    assert.equal(
      parseModuleManifest({
        ...base,
        entrypoint: {
          kind: "commands",
          commands: [
            { capability: "query", command: "acme.routes.run", title: "Run routes" },
          ],
        },
      }).entrypoint.kind,
      "commands",
    );
    const graphforge = parseModuleManifest({
      ...base,
      entrypoint: {
        kind: "graphforge",
        capabilityId: "routes/v1",
        commands: [
          { capability: "query", command: "graphforge.routes", title: "Find routes" },
        ],
      },
    });
    assert.deepEqual(graphforge.capabilities, ["query", "visualize"]);
    assert.equal(graphforge.entrypoint.kind, "graphforge");
    assert.throws(
      () =>
        parseModuleManifest({
          ...base,
          entrypoint: { kind: "extension", extensionId: "acme.routes" },
        }),
      /Unsupported entrypoint kind/,
    );
  });

  test("rejects unversioned, malformed, and unknown-capability manifests", () => {
    const invalid = {
      format: GRAPHFORGE_MODULE_FORMAT,
      id: "Bad ID",
      name: "Bad",
      version: "latest",
      publisher: "Acme",
      description: "Bad module.",
      capabilities: ["teleport"],
      entrypoint: { kind: "builtin" },
    };
    assert.throws(() => parseModuleManifest(invalid), ModuleManifestError);
  });

  test("uses stable short context keys for first-party modules", () => {
    const manifest = parseModuleManifest({
      format: GRAPHFORGE_MODULE_FORMAT,
      id: "graphforge.visualize",
      name: "Visualize",
      version: "1.0.0",
      publisher: "GraphForge",
      description: "Visualize results.",
      capabilities: ["visualize"],
      entrypoint: { kind: "builtin" },
    });
    assert.equal(moduleContextKey(manifest), "graphforge.module.visualize.enabled");
  });

  test("accepts contained CommonJS workspace scripts and rejects escaping paths", () => {
    const base = {
      format: GRAPHFORGE_MODULE_FORMAT,
      id: "acme.local-tools",
      name: "Local tools",
      version: "1.0.0",
      publisher: "Acme",
      description: "Trusted local tools.",
      capabilities: ["integration"],
    };
    assert.deepEqual(
      parseModuleManifest({
        ...base,
        entrypoint: { kind: "workspace-script", script: "./dist/activate.cjs" },
      }).entrypoint,
      { kind: "workspace-script", script: "dist/activate.cjs" },
    );
    for (const script of ["../activate.cjs", "/tmp/activate.js", "activate.mjs"]) {
      assert.throws(
        () =>
          parseModuleManifest({
            ...base,
            entrypoint: { kind: "workspace-script", script },
          }),
        ModuleManifestError,
      );
    }
  });
});
