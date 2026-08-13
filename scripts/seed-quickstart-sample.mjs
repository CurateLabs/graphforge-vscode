#!/usr/bin/env node
/**
 * Smoke-seed the #63 quickstart sample (vendored US air-routes) outside VS Code.
 *
 * Usage:
 *   node scripts/seed-quickstart-sample.mjs [targetDir]
 *
 * Reads media/samples/air-routes/{airports,routes}.csv (Apache-2.0,
 * Kelvin R. Lawrence / krlawrence/graph).
 */
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const MARKER = "graphforge-quickstart/air-routes-us/v1\n";
const datasetDir = path.join(root, "media", "samples", "air-routes");

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function readCsv(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
}

function esc(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function buildSeedCypher(airports, routes) {
  const idToIndex = new Map();
  const parts = [];
  airports.forEach((airport, index) => {
    idToIndex.set(airport.id, index);
    parts.push(
      `(p${index}:Airport {id:'${esc(airport.id)}', code:'${esc(airport.code)}', city:'${esc(airport.city)}', region:'${esc(airport.region)}', runways:${Number(airport.runways) || 0}, elev:${Number(airport.elev) || 0}, lat:${Number(airport.lat) || 0}, lon:${Number(airport.lon) || 0}})`,
    );
  });
  for (const route of routes) {
    const from = idToIndex.get(route.from);
    const to = idToIndex.get(route.to);
    if (from === undefined || to === undefined) continue;
    parts.push(`(p${from})-[:ROUTE {dist:${Number(route.dist) || 0}}]->(p${to})`);
  }
  return `CREATE ${parts.join(",\n")}`;
}

function loadBinding() {
  try {
    return require("@curatelabs/graphforge");
  } catch {
    const sibling = path.resolve(root, "../graphforge/crates/graphforge-bindings-node");
    if (fs.existsSync(path.join(sibling, "index.js"))) {
      return require(sibling);
    }
    throw new Error(
      "Cannot load @curatelabs/graphforge. Install the peer or build the sibling binding.",
    );
  }
}

const airports = readCsv(path.join(datasetDir, "airports.csv"));
const routes = readCsv(path.join(datasetDir, "routes.csv"));
const seed = buildSeedCypher(airports, routes);

const target = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "graphforge-quickstart"));
if (fs.existsSync(target)) {
  fs.rmSync(target, { recursive: true, force: true });
}
fs.mkdirSync(target, { recursive: true });

const { GraphForge } = loadBinding();
const gf = new GraphForge(target, { writeMode: "single_writer" });
const t0 = Date.now();
gf.execute(seed);
const buf = gf.execute(
  "MATCH (a:Airport)-[r:ROUTE]->(b:Airport) RETURN a.code AS source, b.code AS target, type(r) AS type, a.code AS label, r.dist AS dist, a.region AS region",
);
fs.writeFileSync(path.join(target, "QUICKSTART"), MARKER, "utf8");

console.log(`Seeded air-routes sample at ${target}`);
console.log(`Airports: ${airports.length}; routes: ${routes.length}; seedMs: ${Date.now() - t0}`);
console.log(`FORMAT: ${JSON.stringify(fs.readFileSync(path.join(target, "FORMAT"), "utf8"))}`);
console.log(`Sample query IPC bytes: ${buf.length}`);
