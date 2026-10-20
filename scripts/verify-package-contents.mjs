import fs from "node:fs";
import path from "node:path";
import { listFiles } from "@vscode/vsce";

const cwd = process.cwd();
const files = (await listFiles({ cwd })).map((file) => file.replaceAll("\\", "/"));

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
  "vendor/",
  "webview-ui/",
];
const forbiddenFiles = new Set(["design-qa.md"]);
const forbidden = files.filter(
  (file) => forbiddenFiles.has(file) || forbiddenPrefixes.some((prefix) => file.startsWith(prefix)),
);

const required = [
  "dist/extension.js",
  "dist/webview-ui/getStarted.js",
  "dist/webview-ui/getStarted.css",
  "media/samples/air-routes/project/notebooks/air-routes-analysis.ipynb",
  "package.json",
  "README.md",
  // XYG (#80): the paint client and direct-browser WASM host, and the staged
  // native Node host (facade + this platform's core + koffi), with notices.
  "dist/webview-ui/xygVisualization.js",
  "dist/webview-ui/xyg/wasm-worker.js",
  "dist/webview-ui/xyg/xyg-wasm.wasm",
  "dist/webview-ui/xyg/NOTICE",
  "dist/node_modules/@curatelabs/xyg-node/package.json",
  "dist/node_modules/@curatelabs/xyg-node/NOTICE",
  "dist/node_modules/@curatelabs/xyg-node/src/graphforge.js",
  "dist/node_modules/@curatelabs/xyg-node/src/load.js",
  "dist/node_modules/koffi/package.json",
];
// Exactly one staged native core and koffi prebuild for the packaging platform.
const cores = files.filter((file) => /^dist\/node_modules\/@curatelabs\/xyg-node-[a-z0-9-]+\/package\.json$/.test(file));
const prebuilds = files.filter((file) => /^dist\/node_modules\/@koromix\/koffi-[a-z0-9-]+\/package\.json$/.test(file));
if (cores.length === 0) required.push("dist/node_modules/@curatelabs/xyg-node-<platform>/package.json");
if (prebuilds.length === 0) required.push("dist/node_modules/@koromix/koffi-<platform>/package.json");
const missing = required.filter((file) => !files.includes(file));

const totalBytes = files.reduce((sum, file) => {
  const absolute = path.join(cwd, file);
  return sum + (fs.existsSync(absolute) ? fs.statSync(absolute).size : 0);
}, 0);
// Budgets reassessed for the XYG package set (#80/#82). XYG adds about 85
// files and 8.5 MiB on one platform: native core 4.2 MiB, koffi prebuilds
// 2.3 MiB (glibc + musl), Node facade 1.5 MiB / 51 files, WASM 0.9 MiB, and
// paint client 0.5 MiB. Retiring the previous renderers (#82) lowers both.
const maxFiles = 150;
const maxBytes = 21 * 1024 * 1024;

if (forbidden.length > 0 || missing.length > 0 || files.length > maxFiles || totalBytes > maxBytes) {
  if (forbidden.length > 0) console.error(`Forbidden VSIX paths:\n${forbidden.join("\n")}`);
  if (missing.length > 0) console.error(`Missing required VSIX paths:\n${missing.join("\n")}`);
  if (files.length > maxFiles) console.error(`VSIX file count ${files.length} exceeds ${maxFiles}.`);
  if (totalBytes > maxBytes) console.error(`VSIX unpacked size ${totalBytes} exceeds ${maxBytes} bytes.`);
  process.exitCode = 1;
} else {
  console.log(`VSIX contents verified: ${files.length} files, ${totalBytes} bytes unpacked.`);
}
