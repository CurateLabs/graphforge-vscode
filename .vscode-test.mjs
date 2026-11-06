import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "dist/test/**/*.test.js",
  // Hosted desktops have no admitted hardware WebGL2 context. Exercise XYG's
  // same WebGL painter explicitly through Chromium's software GL driver.
  launchArgs: process.env.CI ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] : [],
  mocha: {
    ui: "tdd",
    timeout: 20_000,
  },
});
