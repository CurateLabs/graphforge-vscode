// A dedicated protocol host that refuses graceful close and takes time to exit
// after SIGTERM. PythonBridge disposal must wait for actual process exit.
const readline = require("node:readline");
process.on("SIGTERM", () => setTimeout(() => process.exit(0), 100));
readline.createInterface({ input: process.stdin }).on("line", line => {
  const request = JSON.parse(line);
  process.stdout.write(JSON.stringify({
    id: request.id,
    protocol_version: 1,
    ok: request.op === "open",
    ...(request.op === "open" ? { result: {} } : { error: "close failed", code: "CLOSE_FAILED" }),
  }) + "\n");
});
