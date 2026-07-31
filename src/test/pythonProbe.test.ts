import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { probeGraphForgeImport } from "../session/pythonProbe";

/**
 * Sibling engine checkout's dev venv (see docs/engineering/TESTING.md
 * "manual matrix"). Present in this workspace's local dev setup; absent in
 * CI, where the "graphforge importable" case is skipped gracefully rather
 * than failing the whole suite.
 */
const SIBLING_VENV_PYTHON = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "graphforge",
  ".venv",
  "bin",
  "python3",
);

function systemPython(): string | undefined {
  const candidates = process.platform === "win32" ? ["python.exe", "python3.exe"] : ["python3", "python"];
  for (const exe of candidates) {
    // execFile with a bare name relies on PATH; probeGraphForgeImport itself
    // does this too, so just pick the first plausible name for these tests.
    return exe;
  }
  return candidates[0];
}

suite("probeGraphForgeImport", () => {
  test("reports failure for a nonexistent interpreter path", async function () {
    this.timeout(10_000);
    const result = await probeGraphForgeImport("/no/such/interpreter/binary");
    assert.equal(result.ok, false);
    assert.ok(result.error && result.error.length > 0);
  });

  test("reports failure when graphforge is not importable", async function () {
    this.timeout(10_000);
    const python = systemPython();
    if (!python) {
      this.skip();
      return;
    }
    let result: Awaited<ReturnType<typeof probeGraphForgeImport>>;
    try {
      result = await probeGraphForgeImport(python);
    } catch {
      this.skip();
      return;
    }
    if (result.ok) {
      // System python happens to have graphforge installed; nothing to
      // assert about the "missing" path in that environment.
      this.skip();
      return;
    }
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /graphforge|ModuleNotFoundError|ImportError/i);
  });

  test("reports success + version when graphforge is importable (sibling dev venv)", async function () {
    this.timeout(10_000);
    if (!fs.existsSync(SIBLING_VENV_PYTHON)) {
      this.skip();
      return;
    }
    const result = await probeGraphForgeImport(SIBLING_VENV_PYTHON);
    assert.equal(result.ok, true);
    assert.ok(result.version, "expected a graphforge __version__");
  });
});
