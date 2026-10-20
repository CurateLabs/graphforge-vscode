import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "dist/test/**/*.test.js",
  // Headless CI hosts (Xvfb) have no GPU. SwiftShader gives the webviews a
  // software WebGL2 context so XYG paint is exercised, not skipped (#80).
  launchArgs: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  mocha: {
    ui: "tdd",
    timeout: 20_000,
  },
});
