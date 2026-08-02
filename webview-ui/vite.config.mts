import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";

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
export default defineConfig({
  root: here,
  build: {
    outDir: resolve(here, "..", "dist", "webview-ui"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        settings: resolve(here, "src/settings/main.ts"),
        figure: resolve(here, "src/figure/main.ts"),
        resultGraph: resolve(here, "src/resultGraph/main.ts"),
        artifactVisualization: resolve(here, "src/artifactVisualization/main.ts"),
        results: resolve(here, "src/results/main.ts"),
        entityInspect: resolve(here, "src/entityInspect/main.ts"),
        modules: resolve(here, "src/modules/main.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name][extname]",
      },
    },
  },
});
