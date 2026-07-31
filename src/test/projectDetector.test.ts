import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  classifyInitTarget,
  isGraphForgeProject,
  readCurrentPointer,
  readDirSafe,
} from "../session/projectFormat";
import { PROJECT_FORMAT_BYTES } from "../session/types";

suite("projectDetector", () => {
  let tmp: string;

  suiteSetup(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gf-vscode-"));
  });

  suiteTeardown(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("rejects folder without FORMAT", () => {
    const dir = path.join(tmp, "empty");
    fs.mkdirSync(dir);
    assert.equal(isGraphForgeProject(dir), false);
  });

  test("rejects wrong FORMAT bytes", () => {
    const dir = path.join(tmp, "wrong");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "FORMAT"), "not-graphforge\n");
    assert.equal(isGraphForgeProject(dir), false);
  });

  test("accepts exact PROJECT_FORMAT_BYTES", () => {
    const dir = path.join(tmp, "ok");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "FORMAT"), PROJECT_FORMAT_BYTES);
    assert.equal(isGraphForgeProject(dir), true);
  });

  test("reads CURRENT pointer when valid", () => {
    const dir = path.join(tmp, "current");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "FORMAT"), PROJECT_FORMAT_BYTES);
    fs.writeFileSync(
      path.join(dir, "CURRENT"),
      JSON.stringify({
        format: "graphforge-project",
        format_version: 1,
        generation_uuid: "01900000-0000-7000-8000-000000000001",
        generation_manifest_sha256: "a".repeat(64),
      }) + "\n",
    );
    const cur = readCurrentPointer(dir);
    assert.ok(cur);
    assert.equal(cur?.generation_uuid, "01900000-0000-7000-8000-000000000001");
  });
});

suite("readDirSafe", () => {
  test("returns undefined for a missing path", () => {
    assert.equal(readDirSafe(path.join(os.tmpdir(), "gf-vscode-does-not-exist")), undefined);
  });
});

suite("classifyInitTarget", () => {
  let tmp: string;

  suiteSetup(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gf-vscode-init-"));
  });

  suiteTeardown(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("missing directory", () => {
    const dir = path.join(tmp, "does-not-exist");
    assert.deepEqual(classifyInitTarget(dir), { kind: "missing" });
  });

  test("empty directory", () => {
    const dir = path.join(tmp, "empty");
    fs.mkdirSync(dir);
    assert.deepEqual(classifyInitTarget(dir), { kind: "empty" });
  });

  test("already a GraphForge project", () => {
    const dir = path.join(tmp, "project");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "FORMAT"), PROJECT_FORMAT_BYTES);
    assert.deepEqual(classifyInitTarget(dir), { kind: "already-project" });
  });

  test("non-empty foreign directory reports its entries", () => {
    const dir = path.join(tmp, "foreign");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "readme.txt"), "hello");
    const result = classifyInitTarget(dir);
    assert.equal(result.kind, "non-empty");
    if (result.kind === "non-empty") {
      assert.deepEqual(result.entries, ["readme.txt"]);
    }
  });
});
