const assert = require("node:assert/strict");
const { test } = require("node:test");
const { resolveWindowsCli } = require("./qualify-hub-clone.cjs");

test("Windows CLI follows the actual 1.142.0 archive launcher", () => {
  // Actual bin/code.cmd from the public win32-x64-archive, rather than its
  // source template: application resources live under a versioned directory.
  const launcher = String.raw`"%~dp0..\Code.exe" "%~dp0..\6d62b1d5da\resources\app\out\cli.js" %*`;
  assert.equal(
    resolveWindowsCli(String.raw`C:\Apps\Code & Tools\Code.exe`, launcher),
    String.raw`C:\Apps\Code & Tools\6d62b1d5da\resources\app\out\cli.js`,
  );
});

test("Windows CLI also follows the earlier flat-layout launcher", () => {
  const launcher = String.raw`"%~dp0..\Code.exe" "%~dp0..\resources\app\out\cli.js" %*`;
  assert.equal(
    resolveWindowsCli(String.raw`C:\Code\Code.exe`, launcher),
    String.raw`C:\Code\resources\app\out\cli.js`,
  );
});

test("unknown or escaping Windows launchers fail explicitly", () => {
  assert.throws(() => resolveWindowsCli(String.raw`C:\Code\Code.exe`, "unknown launcher"), /does not identify/);
  const escaping = String.raw`"%~dp0..\..\other\resources\app\out\cli.js"`;
  assert.throws(() => resolveWindowsCli(String.raw`C:\Code\Code.exe`, escaping), /inside its installation/);
});
