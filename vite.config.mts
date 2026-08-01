/*
 * Node library build for the VS Code extension host — no dev server, no HMR,
 * no app-mode assumptions apply.
 *
 * Phase 2 of the esbuild → Vite direction (issue #24). Two SSR/library builds:
 *
 *   vite build                → dist/extension.js (single flat CJS bundle)
 *   vite build --mode tests   → per-test-file CJS bundles in dist/test/,
 *                               plus a copy of src/test/fixtures/
 *
 * Parity contract with the retired esbuild.mjs: CJS output targeting node20,
 * `vscode` and the optional peer `@graphforge/node` external, `apache-arrow`
 * bundled, source maps emitted without inlined sources. The webview build is
 * separate and app-shaped: webview-ui/vite.config.mts.
 */
import { cpSync, existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { defineConfig, type Plugin, type UserConfig } from "vite";

const external = ["vscode", "@graphforge/node"];

function hostConfig(): UserConfig {
  return {
    build: {
      ssr: "src/extension.ts",
      outDir: "dist",
      // dist/ also holds dist/test/ and dist/webview-ui/ from the other builds.
      emptyOutDir: false,
      target: "node20",
      sourcemap: true,
      minify: false,
      rollupOptions: {
        external,
        output: {
          format: "cjs",
          entryFileNames: "extension.js",
          inlineDynamicImports: true,
          sourcemapExcludeSources: true,
        },
      },
    },
    ssr: {
      // Bundle all real dependencies (apache-arrow); Rollup's `external`
      // above still keeps vscode and @graphforge/node out of the bundle.
      noExternal: true,
    },
  };
}

function testsConfig(): UserConfig {
  const testFiles = readdirSync("src/test")
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => join("src/test", f));

  return {
    plugins: [copyTestFixtures()],
    build: {
      ssr: true,
      outDir: "dist/test",
      emptyOutDir: true,
      target: "node20",
      sourcemap: true,
      minify: false,
      rollupOptions: {
        input: Object.fromEntries(
          testFiles.map((f) => [basename(f, ".ts"), f]),
        ),
        external,
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
          // Shared chunks stay out of the *.test.js globs used by mocha
          // (package.json#test:unit) and vscode-test (.vscode-test.mjs).
          chunkFileNames: "chunks/[name]-[hash].js",
          sourcemapExcludeSources: true,
        },
      },
    },
    ssr: { noExternal: true },
  };
}

/**
 * Non-.test.ts assets (e.g. fake subprocess hosts used by pythonBridge tests)
 * aren't followed by the bundler; copy them alongside the compiled test
 * bundles so `__dirname`-relative lookups still resolve.
 */
function copyTestFixtures(): Plugin {
  return {
    name: "graphforge:copy-test-fixtures",
    closeBundle() {
      const fixturesDir = join("src", "test", "fixtures");
      if (existsSync(fixturesDir)) {
        cpSync(fixturesDir, join("dist", "test", "fixtures"), {
          recursive: true,
        });
      }
    },
  };
}

export default defineConfig(({ mode }) =>
  mode === "tests" ? testsConfig() : hostConfig(),
);
