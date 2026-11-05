import { spawnSync } from "node:child_process";
const platform = process.platform === "win32" ? "win32" : process.platform;
const target = `${platform}-${process.arch}`;
const result = spawnSync(
  process.execPath,
  [
    "node_modules/@vscode/vsce/vsce",
    "package",
    "--target",
    target,
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
