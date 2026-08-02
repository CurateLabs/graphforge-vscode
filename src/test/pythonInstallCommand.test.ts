import * as assert from "node:assert/strict";
import { describeUvInstallCommand, uvInstallCommand } from "../session/pythonInstallCommand";

/**
 * Regression guard for the #12 product decision (uv-only per #12's "Product
 * feedback" comment): `GraphForge: Setup Python Binding` must never surface
 * or run a bare `pip`/`pip3` install command, in any workspace shape. See
 * `docs/REQUIREMENTS.md` FR-16.
 */
function assertNeverBarePip(command: string | undefined): void {
  if (!command) {
    return;
  }
  assert.ok(command.startsWith("uv "), `expected a uv-prefixed command, got: ${command}`);
  assert.doesNotMatch(
    command,
    /(?<!uv )\bpip3?\s+install\b/,
    `command must never invoke bare pip/pip3 install (only uv's own "uv pip install" subcommand is allowed): ${command}`,
  );
}

suite("describeUvInstallCommand", () => {
  test("uv-managed project (pyproject.toml/uv.lock) describes uv add", () => {
    const label = describeUvInstallCommand(true);
    assert.equal(label, "uv add graphforge");
    assertNeverBarePip(label);
  });

  test("non-uv-managed workspace describes uv pip install", () => {
    const label = describeUvInstallCommand(false);
    assert.equal(label, "uv pip install graphforge");
    assertNeverBarePip(label);
  });

  test("a pinned version quotes the requirement so the shell keeps == intact", () => {
    assert.equal(describeUvInstallCommand(true, "0.5.1"), 'uv add "graphforge==0.5.1"');
    assert.equal(describeUvInstallCommand(false, "0.5.1"), 'uv pip install "graphforge==0.5.1"');
    assertNeverBarePip(describeUvInstallCommand(true, "0.5.1"));
    assertNeverBarePip(describeUvInstallCommand(false, "0.5.1"));
  });

  test('"latest" / empty version are unpinned (bare graphforge, no ==)', () => {
    assert.equal(describeUvInstallCommand(true, "latest"), "uv add graphforge");
    assert.equal(describeUvInstallCommand(true, ""), "uv add graphforge");
    assert.equal(describeUvInstallCommand(false, undefined), "uv pip install graphforge");
  });
});

suite("uvInstallCommand", () => {
  test("uv-managed project always uses uv add, regardless of interpreter path", () => {
    assert.equal(uvInstallCommand(true, undefined), "uv add graphforge");
    assert.equal(uvInstallCommand(true, "/usr/bin/python3"), "uv add graphforge");
  });

  test("non-uv project with a known interpreter targets it via uv pip install --python", () => {
    const command = uvInstallCommand(false, "/opt/venv/bin/python");
    assert.equal(command, 'uv pip install --python "/opt/venv/bin/python" graphforge');
    assertNeverBarePip(command);
  });

  test("non-uv project with no known interpreter returns undefined (never falls back to bare pip)", () => {
    assert.equal(uvInstallCommand(false, undefined), undefined);
  });

  test("a pinned version threads through both uv add and uv pip install", () => {
    assert.equal(uvInstallCommand(true, undefined, "0.5.1"), 'uv add "graphforge==0.5.1"');
    assert.equal(
      uvInstallCommand(false, "/opt/venv/bin/python", "0.5.1"),
      'uv pip install --python "/opt/venv/bin/python" "graphforge==0.5.1"',
    );
  });

  test('"latest"/empty version keeps the unpinned form', () => {
    assert.equal(uvInstallCommand(true, undefined, "latest"), "uv add graphforge");
    assert.equal(
      uvInstallCommand(false, "/opt/venv/bin/python", ""),
      'uv pip install --python "/opt/venv/bin/python" graphforge',
    );
  });

  test("every reachable command starts with uv and never invokes bare pip/pip3", () => {
    const interpreters = [undefined, "/usr/bin/python3", 'C:\\Python312\\python.exe'];
    for (const looksLikeUvProject of [true, false]) {
      for (const interpreterPath of interpreters) {
        assertNeverBarePip(uvInstallCommand(looksLikeUvProject, interpreterPath));
      }
    }
    assertNeverBarePip(describeUvInstallCommand(true));
    assertNeverBarePip(describeUvInstallCommand(false));
  });
});
