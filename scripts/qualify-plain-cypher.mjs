/** Bounded native qualification. Build first, then pass an installed Core module path. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tableFromIPC } from "apache-arrow";
import * as xy from "../dist/xyg/node/src/index.js";

const require = createRequire(import.meta.url);
const corePath = process.argv[2];
assert.ok(corePath, "Pass the installed @curatelabs/graphforge module path");
const { GraphForge } = require(path.resolve(corePath));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = fs.mkdtempSync(path.join(os.tmpdir(), "gf-plain-cypher-"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const uuid = (bytes) => {
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const options = {
  layout: "cose",
  iterations: 20,
  width: 480,
  height: 320,
  theme: "light",
};
const cases = [];
let gf;
let savedGraph;
try {
  gf = new GraphForge(project, { writeMode: "single_writer" });
  gf.execute(
    "CREATE (a:Airport {code:'MHK'}), (b:Airport {code:'DEN'}), (a)-[:ROUTE]->(b), (a)-[:ROUTE]->(b), (a)-[:ROUTE]->(a)",
  );
  const generation = uuid(gf.committedGenerationIdentity().generationUuid);
  for (const [name, query, counts] of [
    ["nodes-only", "MATCH (a) RETURN a", [2, 0]],
    ["nodes-and-relationships", "MATCH (a)-[r]->(b) RETURN a,r,b", [2, 3]],
    [
      "empty-nodes",
      "MATCH (a:Airport) WHERE a.code = 'ABSENT' RETURN a",
      [0, 0],
    ],
    [
      "empty-nodes-and-relationships",
      "MATCH (a)-[r]->(b) WHERE a.code = 'ABSENT' RETURN a,r,b",
      [0, 0],
    ],
  ]) {
    const ipc = gf.execute(query);
    const input = { base: { tables: [ipc], generation } };
    const c = xy.composeGraphForge(input);
    assert.equal(input.base.tables[0], ipc);
    assert.deepEqual([c.nodes.count, c.edges.count], counts);
    assert.equal(c.baseGeneration, generation);
    if (counts[0])
      assert.deepEqual(new Set(c.nodes.label), new Set(["MHK", "DEN"]));
    // Independent Core Arrow identities verify preservation, without a host graph builder.
    const nodes = new Set(),
      edges = new Set();
    for (const row of tableFromIPC(ipc)) {
      for (const value of Object.values(row.toJSON())) {
        if (value?.node_uuid) nodes.add(uuid(value.node_uuid));
        if (value?.edge_uuid) edges.add(uuid(value.edge_uuid));
      }
    }
    assert.deepEqual(new Set(c.nodes.uuid), nodes);
    assert.deepEqual(new Set(c.edges.uuid), edges);
    if (counts[1]) {
      assert.equal(
        c.edges.source.filter((s, i) => s === c.edges.target[i]).length,
        1,
      );
      assert.equal(
        new Set(
          Array.from(c.edges.source, (s, i) => `${s}:${c.edges.target[i]}`),
        ).size,
        2,
      );
      assert.ok([...c.edges.status].every((status) => status === 1));
      savedGraph = { nodes: c.nodes.uuid, edges: c.edges.uuid };
    }
    const owner = new xy.GraphForgeLayoutController();
    const repeatOwner = new xy.GraphForgeLayoutController();
    let first, second;
    try {
      first = await owner.render(input, options);
      second = await repeatOwner.render(input, options);
      assert.equal(first.phase, "complete");
      assert.deepEqual(first.positions, second.positions);
      assert.ok(first.buffer.byteLength > 0);
    } finally {
      await Promise.all([owner.dispose(), repeatOwner.dispose()]);
    }
    const exported = () =>
      xy.graphforgeStaticPayload(c, {
        ...options,
        layout: "preset",
        positions: first.positions,
      }).figure;
    const a = exported(),
      b = exported();
    const svg = a.toSvg(),
      png = a.toPng();
    assert.deepEqual(svg, b.toSvg());
    assert.deepEqual(png, b.toPng());
    if (counts[0])
      assert.match(Buffer.from(svg).toString("utf8"), />(MHK|DEN)</);
    cases.push({
      name,
      nodes: counts[0],
      edges: counts[1],
      nativeLayout: "complete",
      repeatedLayoutAndExports: "identical",
      arrowSha256: digest(ipc),
      svgSha256: digest(svg),
      pngSha256: digest(png),
    });
  }
  gf.close();
  gf = new GraphForge(project, { writeMode: "single_writer" });
  assert.equal(
    uuid(gf.committedGenerationIdentity().generationUuid),
    generation,
  );
  const reopened = xy.composeGraphForge({
    base: {
      tables: [gf.execute("MATCH (a)-[r]->(b) RETURN a,r,b")],
      generation,
    },
  });
  // Core query row order can change on reopen; UUID identities cannot.
  assert.deepEqual(new Set(reopened.nodes.uuid), new Set(savedGraph.nodes));
  assert.deepEqual(new Set(reopened.edges.uuid), new Set(savedGraph.edges));
  const report = {
    platform: `${process.platform}-${process.arch}`,
    core: require(path.join(path.resolve(corePath), "package.json")).version,
    xyg: JSON.parse(
      fs.readFileSync(path.join(root, "dist/xyg/provenance.json")),
    ),
    cases,
    reopenIdentitiesAndGeneration: "preserved",
    limits: [
      "Determinism compares identical Arrow input and generation; fresh Core queries can reorder rows on reopen",
      "Native bounded fixtures only; no browser pixel parity or release/platform qualification",
    ],
  };
  const json = JSON.stringify(report, null, 2) + "\n";
  if (process.argv[3]) fs.writeFileSync(process.argv[3], json);
  process.stdout.write(json);
} finally {
  gf?.close();
  fs.rmSync(project, { recursive: true, force: true });
}
