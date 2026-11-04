import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "vendor/xyg");
const output = path.join(root, "dist/xyg");
const run = (command, args, cwd = source) => {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${command} failed (${result.status})`);
};
if (!fs.existsSync(path.join(source, "Cargo.toml"))) {
  run("git", ["submodule", "update", "--init", "vendor/xyg"], root);
}
const library =
  process.platform === "darwin"
    ? "libxyg_core.dylib"
    : process.platform === "win32"
      ? "xyg_core.dll"
      : "libxyg_core.so";
// Cargo tracks source/toolchain inputs; existence alone cannot validate an artifact.
run("cargo", ["build", "--release", "-p", "xyg-core"]);
const lockDigest = createHash("sha256")
  .update(fs.readFileSync(path.join(source, "package-lock.json")))
  .digest("hex");
const dependencyStamp = path.join(source, "node_modules/.graphforge-lock");
if (
  !fs.existsSync(path.join(source, "node_modules/typescript/bin/tsc")) ||
  !fs.existsSync(dependencyStamp) ||
  fs.readFileSync(dependencyStamp, "utf8") !== lockDigest
) {
  run("npm", ["ci"]);
  fs.writeFileSync(dependencyStamp, lockDigest);
}
run(process.execPath, ["js/build.mjs"]);
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
fs.cpSync(
  path.join(source, "packages/xy-node/src"),
  path.join(output, "node/src"),
  { recursive: true },
);
fs.mkdirSync(path.join(output, "client"), { recursive: true });
fs.copyFileSync(
  path.join(source, "packages/xy-client/dist/index.js"),
  path.join(output, "client/index.js"),
);
fs.copyFileSync(
  path.join(source, "packages/xy-node/package.json"),
  path.join(output, "node/package.json"),
);
const platform = `${process.platform}-${process.arch}`;
const native = path.join(
  output,
  `node/node_modules/@curatelabs/xyg-node-${platform}`,
);
fs.mkdirSync(native, { recursive: true });
fs.writeFileSync(
  path.join(native, "package.json"),
  JSON.stringify({
    name: `@curatelabs/xyg-node-${platform}`,
    version: "0.0.0",
    private: true,
  }),
);
fs.copyFileSync(
  path.join(source, "target/release", library),
  path.join(native, library),
);
const require = createRequire(import.meta.url);
const koffi = path.dirname(require.resolve("koffi"));
fs.cpSync(koffi, path.join(output, "node/node_modules/koffi"), {
  recursive: true,
  filter: (p) =>
    fs.statSync(p).isDirectory() || /\.(?:js|cjs|json|node|md|txt)$/.test(p),
});
const koffiPlatform = `@koromix/koffi-${platform}`;
fs.cpSync(
  path.dirname(require.resolve(koffiPlatform)),
  path.join(output, "node/node_modules", koffiPlatform),
  { recursive: true },
);
for (const file of [
  "LICENSE",
  "packages/xy-node/NOTICE",
  "packages/xy-client/NOTICE",
]) {
  fs.copyFileSync(
    path.join(source, file),
    path.join(output, file.replaceAll("/", "-")),
  );
}
const revision = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: source,
  encoding: "utf8",
}).stdout.trim();
fs.writeFileSync(
  path.join(output, "provenance.json"),
  JSON.stringify(
    {
      repository: "https://github.com/CurateLabs/xyg",
      revision,
      platform,
      dirty:
        spawnSync("git", ["status", "--porcelain"], {
          cwd: source,
          encoding: "utf8",
        }).stdout.trim().length > 0,
    },
    null,
    2,
  ),
);
console.log(`XYG ${revision} (${platform}) bundled into dist/xyg`);
