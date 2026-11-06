/** Bundle the exact locked public Core facade and only this host's native package. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json")));
const version = manifest.dependencies["@curatelabs/graphforge"];
assert.match(version, /^\d+\.\d+\.\d+(?:-[\w.]+)?$/, "Core must be pinned exactly");
const platform = `${process.platform}-${process.arch}`;
const suffix = process.platform === "linux" ? "-gnu" : process.platform === "win32" ? "-msvc" : "";
const nativeName = `@curatelabs/graphforge-${platform}${suffix}`;
const output = path.join(root, "dist/core");
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json")));
fs.rmSync(output, { recursive: true, force: true });
const packages = [];
for (const name of ["@curatelabs/graphforge", nativeName]) {
  const source = path.dirname(require.resolve(`${name}/package.json`));
  const pkg = JSON.parse(fs.readFileSync(path.join(source, "package.json")));
  assert.equal(pkg.version, version, "Core facade and platform package versions must agree");
  const locked = lock.packages[`node_modules/${name}`];
  assert.ok(locked?.integrity && locked.version === version, "Core package must have locked registry integrity");
  const destination = path.join(output, "node_modules", name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
  packages.push({ name, version, integrity: locked.integrity });
}
const native = path.join(output, "node_modules", nativeName, `graphforge.${platform}${suffix}.node`);
assert.ok(fs.statSync(native).isFile(), "Expected exact-platform Core native binary");
const core = require(path.join(output, "node_modules/@curatelabs/graphforge"));
assert.equal(core.version(), version);
fs.writeFileSync(path.join(output, "provenance.json"), JSON.stringify({ version, platform, packages, nativeBytes: fs.statSync(native).size, nativeSha256: createHash("sha256").update(fs.readFileSync(native)).digest("hex") }, null, 2) + "\n");
console.log(`Core ${version} (${platform}) bundled with locked registry integrity`);
