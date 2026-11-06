import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { readPinnedFixture } from "./qualify-xyg.mjs";

test("fixture changes after a clean build fail against the immutable owner pin", () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "gf-fixture-pin-"));
  const git = (...args) => execFileSync("git", args, { cwd: source, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    git("init", "--quiet");
    const file = path.join(source, "fixture.arrow");
    fs.writeFileSync(file, "canonical fixture");
    git("add", "fixture.arrow");
    git("-c", "user.name=Qualification", "-c", "user.email=qualification@example.invalid", "commit", "--quiet", "-m", "fixture");
    const pin = git("rev-parse", "HEAD").trim();
    assert.equal(readPinnedFixture(source, pin, "fixture.arrow").toString(), "canonical fixture");
    fs.writeFileSync(file, "a different valid fixture");
    assert.throws(() => readPinnedFixture(source, pin, "fixture.arrow"), /differs from the pinned XYG tree/);
  } finally { fs.rmSync(source, { recursive: true, force: true }); }
});
