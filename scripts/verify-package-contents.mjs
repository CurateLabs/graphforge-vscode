import fs from "node:fs";
import path from "node:path";
import { listFiles } from "@vscode/vsce";

const cwd = process.cwd();
const files = (await listFiles({ cwd })).map((file) =>
  file.replaceAll("\\", "/"),
);

const forbiddenPrefixes = [
  ".claude/",
  ".git/",
  ".impeccable/",
  ".kilo/",
  ".productfeeling/",
  ".redteam/",
  ".vscode-test/",
  "agent-transcripts/",
  "docs/",
  "onboarding-design-qa/",
  "scripts/",
  "src/",
  "webview-ui/",
  "vendor/",
];
const retiredAssets =
  /(?:resultGraph|artifactVisualization|figure|layout\.worker)\.(?:js|css)$/;
const forbiddenFiles = new Set(["design-qa.md", "TASKS.md"]);
const forbidden = files.filter(
  (file) =>
    forbiddenFiles.has(file) ||
    (file.startsWith("dist/webview-ui/") && retiredAssets.test(file)) ||
    forbiddenPrefixes.some((prefix) => file.startsWith(prefix)),
);

const required = [
  "dist/extension.js",
  "dist/core/provenance.json",
  "dist/core/node_modules/@curatelabs/graphforge/index.js",
  "dist/core/node_modules/@curatelabs/graphforge/LICENSE",
  "dist/core/node_modules/@curatelabs/graphforge/NOTICE",
  "dist/core/node_modules/@curatelabs/graphforge/THIRD_PARTY_NOTICES.md",
  "dist/webview-ui/getStarted.js",
  "dist/webview-ui/getStarted.css",
  "dist/webview-ui/xyg.js",
  "dist/webview-ui/xyg.css",
  "dist/xyg/node/client/index.js",
  "dist/xyg/node/client/wasm-worker.js",
  "dist/xyg/node/client/xyg-wasm.wasm",
  "dist/xyg/node/client/xyg-wasm.manifest.json",
  "dist/xyg/node/src/index.js",
  "dist/xyg/node/client/standalone.js",
  "dist/xyg/node/client/wasm-standalone-worker.js",
  "dist/xyg/node/src/intent.cjs",
  "dist/xyg/node/node_modules/koffi/index.cjs",
  "dist/xyg/node/node_modules/koffi/LICENSE.txt",
  "dist/xyg/provenance.json",
  "dist/xyg/LICENSE",
  "dist/xyg/packages-xy-node-NOTICE",
  "dist/xyg/packages-xy-client-NOTICE",
  "media/samples/air-routes/project/notebooks/air-routes-analysis.ipynb",
  "package.json",
  "README.md",
];
const platform = `${process.platform}-${process.arch}`;
const coreSuffix = process.platform === "linux" ? "-gnu" : process.platform === "win32" ? "-msvc" : "";
const coreNative = `dist/core/node_modules/@curatelabs/graphforge-${platform}${coreSuffix}`;
required.push(`${coreNative}/graphforge.${platform}${coreSuffix}.node`, `${coreNative}/LICENSE`, `${coreNative}/NOTICE`, `${coreNative}/THIRD_PARTY_NOTICES.md`);
const library =
  process.platform === "darwin"
    ? "libxyg_core.dylib"
    : process.platform === "win32"
      ? "xyg_core.dll"
      : "libxyg_core.so";
required.push(
  `dist/xyg/node/node_modules/@curatelabs/xyg-node-${platform}/${library}`,
);
required.push(
  `dist/xyg/node/node_modules/@koromix/koffi-${platform}/${process.platform}_${process.arch}/koffi.node`,
);
const manifest = JSON.parse(fs.readFileSync("package.json", "utf8"));
const retiredDependencies = [
  "cytoscape",
  "sigma",
  "graphology",
  "graphology-layout-forceatlas2",
  "plotly.js-dist-min",
  "@antv/g6",
  "@antv/g2",
  "@antv/l7",
  "@antv/l7-maps",
];
for (const dependency of retiredDependencies)
  if (manifest.dependencies?.[dependency])
    throw new Error(`Retired renderer dependency: ${dependency}`);
const missing = required.filter((file) => !files.includes(file));

const totalBytes = files.reduce((sum, file) => {
  const absolute = path.join(cwd, file);
  return sum + (fs.existsSync(absolute) ? fs.statSync(absolute).size : 0);
}, 0);
// Core's complete native engine is now included, rather than an external prerequisite.
// Keep one platform binary; the old 15 MiB limit covered only XYG and the editor.
const maxFiles = 240;
const maxBytes = 256 * 1024 * 1024;

if (
  forbidden.length > 0 ||
  missing.length > 0 ||
  files.length > maxFiles ||
  totalBytes > maxBytes
) {
  if (forbidden.length > 0)
    console.error(`Forbidden VSIX paths:\n${forbidden.join("\n")}`);
  if (missing.length > 0)
    console.error(`Missing required VSIX paths:\n${missing.join("\n")}`);
  if (files.length > maxFiles)
    console.error(`VSIX file count ${files.length} exceeds ${maxFiles}.`);
  if (totalBytes > maxBytes)
    console.error(
      `VSIX unpacked size ${totalBytes} exceeds ${maxBytes} bytes.`,
    );
  process.exitCode = 1;
} else {
  console.log(
    `VSIX contents verified: ${files.length} files, ${totalBytes} bytes unpacked.`,
  );
}
