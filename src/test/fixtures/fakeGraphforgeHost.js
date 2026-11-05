// Minimal stand-in for python/graphforge_host.py's line protocol, run via
// `node fakeGraphforgeHost.js` in pythonBridge.test.ts so PythonBridge /
// PythonEngineBackend framing, correlation, and error-marshalling logic can
// be unit tested without a real Python interpreter or the graphforge
// package installed.
const readline = require("node:readline");

const PROTOCOL_VERSION = 1;

let generation = 1;
const generationUuid = () => `0190a000-0000-7000-8000-${String(generation).padStart(12, "0")}`;

function encodeTable(rows, includeIdentity = true) {
  // Not real Arrow IPC — pythonBridge.test.ts only checks the base64 payload
  // round-trips through PythonEngineBackend as a Buffer, it never decodes it.
  const payload = Buffer.from(JSON.stringify(rows), "utf8");
  return { arrow_ipc_base64: payload.toString("base64"), ...(includeIdentity ? { generation_uuid: generationUuid() } : {}) };
}

let opened = false;

function handle(request) {
  const op = request.op;
  if (op === "open") {
    if (!request.path) {
      throw Object.assign(new Error("open requires 'path'"), { code: "GF_BAD_ARGS" });
    }
    opened = true;
    generation = 1;
    return { path: request.path, ontology_mode: "exploratory", graphforge_version: "fake-1.0.0" };
  }
  if (!opened) {
    throw new Error(`no project open — cannot handle op ${op}`);
  }
  if (op === "execute") {
    if (request.cypher === "FAIL") {
      throw Object.assign(new Error("simulated query failure"), { code: "GF_QUERY_FAILED" });
    }
    if (request.cypher === "MUTATE") generation += 1;
    const result = encodeTable([{ cypher: request.cypher, params: request.params ?? null }], request.cypher !== "NO_IDENTITY");
    if (request.cypher === "INVALID_IDENTITY") result.generation_uuid = "not-a-uuid";
    return result;
  }
  if (op === "verb") {
    return encodeTable([{ verb: request.verb, args: request.args }]);
  }
  if (op === "labels") {
    return { labels: ["Person", "Org"] };
  }
  if (op === "relationship_types") {
    return { relationship_types: ["KNOWS"] };
  }
  if (op === "ontology_mode") {
    return { ontology_mode: "exploratory" };
  }
  if (op === "load_ontology") {
    return {};
  }
  if (op === "list_assertions") {
    return encodeTable([]);
  }
  if (op === "close") {
    opened = false;
    return { closed: true };
  }
  throw new Error(`unknown op ${op}`);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  const request = JSON.parse(trimmed);
  let response;
  try {
    const result = handle(request);
    response = { id: request.id, protocol_version: PROTOCOL_VERSION, ok: true, result };
  } catch (err) {
    response = {
      id: request.id,
      protocol_version: PROTOCOL_VERSION,
      ok: false,
      error: err.message,
      error_kind: err.constructor.name,
      code: err.code ?? null,
    };
  }
  process.stdout.write(JSON.stringify(response) + "\n");
  if (request.op === "close" && response.ok) {
    process.exit(0);
  }
});
