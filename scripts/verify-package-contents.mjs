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
];
const missing = required.filter((file) => !files.includes(file));

const totalBytes = files.reduce((sum, file) => {
  const absolute = path.join(cwd, file);
  return sum + (fs.existsSync(absolute) ? fs.statSync(absolute).size : 0);
}, 0);
const maxFiles = 100;
const maxBytes = 15 * 1024 * 1024;

if (forbidden.length > 0 || missing.length > 0 || files.length > maxFiles || totalBytes > maxBytes) {
  if (forbidden.length > 0) console.error(`Forbidden VSIX paths:\n${forbidden.join("\n")}`);
  if (missing.length > 0) console.error(`Missing required VSIX paths:\n${missing.join("\n")}`);
  if (files.length > maxFiles) console.error(`VSIX file count ${files.length} exceeds ${maxFiles}.`);
  if (totalBytes > maxBytes) console.error(`VSIX unpacked size ${totalBytes} exceeds ${maxBytes} bytes.`);
  process.exitCode = 1;
} else {
  console.log(`VSIX contents verified: ${files.length} files, ${totalBytes} bytes unpacked.`);
}
