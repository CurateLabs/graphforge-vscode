import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));

/**
 * Webview UI build (Phase 1 of the esbuild → Vite direction, issue #24).
 * Builds browser bundles for GraphForge webview panels into dist/webview-ui/,
 * which the extension host serves via `webview.asWebviewUri`. The extension
 * host builds separately as a Node library — see vite.config.mts at the repo
 * root; nothing app-mode from this config applies there.
 *
 * File names are fixed (no content hashes): the host references
 * dist/webview-ui/settings.js / settings.css directly, and webview panels
 * reload their HTML on every open so cache-busting hashes buy nothing.
 */
/**
 * The XYG direct-browser WASM host loads its module Worker and WASM artifact
 * as local webview resources (#80). Copy them verbatim from the pinned
 * `@curatelabs/xyg` package, never from a CDN, and never mixing versions.
 */
function copyXygBrowserAssets(): Plugin {
  return {
    name: "graphforge:copy-xyg-browser-assets",
    closeBundle() {
      const source = resolve(here, "..", "node_modules", "@curatelabs", "xyg");
      const target = resolve(here, "..", "dist", "webview-ui", "xyg");
      mkdirSync(target, { recursive: true });
      for (const file of ["dist/wasm-worker.js", "dist/xyg-wasm.wasm", "NOTICE", "LICENSE", "ASSET-MANIFEST.json"]) {
        cpSync(resolve(source, file), resolve(target, file.replace(/^dist\//, "")));
      }
    },
  };
}

export default defineConfig({
  root: here,
  plugins: [copyXygBrowserAssets()],
  build: {
    outDir: resolve(here, "..", "dist", "webview-ui"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        getStarted: resolve(here, "src/getStarted/main.js"),
        settings: resolve(here, "src/settings/main.ts"),
        figure: resolve(here, "src/figure/main.ts"),
        resultGraph: resolve(here, "src/resultGraph/main.ts"),
        artifactVisualization: resolve(here, "src/artifactVisualization/main.ts"),
        results: resolve(here, "src/results/main.ts"),
        entityInspect: resolve(here, "src/entityInspect/main.ts"),
        modules: resolve(here, "src/modules/main.ts"),
        xygVisualization: resolve(here, "src/xygVisualization/main.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name][extname]",
      },
    },
  },
});
