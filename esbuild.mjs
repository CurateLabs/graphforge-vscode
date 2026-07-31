import * as esbuild from "esbuild";
import { cpSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const extensionOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode", "@graphforge/node"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  sourcesContent: false,
  minify: false,
  logLevel: "info",
};

const testFiles = readdirSync("src/test")
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => join("src/test", f));

/** @type {import('esbuild').BuildOptions} */
const testOptions = {
  entryPoints: testFiles,
  bundle: true,
  outdir: "dist/test",
  external: ["vscode", "@graphforge/node"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  sourcesContent: false,
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(extensionOptions);
  await ctx.watch();
  console.log("watching…");
} else {
  await esbuild.build(extensionOptions);
  if (testFiles.length) {
    await esbuild.build(testOptions);
    // Non-.test.ts assets (e.g. fake subprocess hosts used by pythonBridge
    // tests) aren't followed by esbuild's bundler; copy them alongside the
    // compiled test bundles so `__dirname`-relative lookups still resolve.
    const fixturesDir = join("src", "test", "fixtures");
    if (existsSync(fixturesDir)) {
      cpSync(fixturesDir, join("dist", "test", "fixtures"), { recursive: true });
    }
  }
}
