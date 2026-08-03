import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  PROJECT_MUTATIONS_DIR,
  relativeProjectPath,
} from "./projectArtifacts";

/** Marker file written after a successful quickstart seed (#63). */
export const QUICKSTART_MARKER = "QUICKSTART";
/** Bumped when the seeded dataset identity changes. */
export const QUICKSTART_MARKER_BYTES = "graphforge-quickstart/air-routes-us/v1\n";

/** Default folder name when materializing under a workspace root. */
export const QUICKSTART_DIR_NAME = "graphforge-quickstart";

/** Analyst-facing Python path copied into every air-routes sample project. */
export const QUICKSTART_NOTEBOOK_REL = path.join(
  "notebooks",
  "air-routes-analysis.ipynb",
);

/** Relative path (from the extension root) to the vendored Apache-2.0 sample. */
export const QUICKSTART_DATASET_REL = path.join("media", "samples", "air-routes");

export type QuickstartAirport = {
  id: string;
  code: string;
  city: string;
  region: string;
  runways: number;
  elev: number;
  lat: number;
  lon: number;
};

export type QuickstartRoute = {
  from: string;
  to: string;
  dist: number;
};

export type QuickstartDataset = {
  airports: QuickstartAirport[];
  routes: QuickstartRoute[];
  datasetDir: string;
};

function escCypherString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
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

function readCsvRecords(filePath: string): Record<string, string>[] {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length < 2) {
    return [];
  }
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = cells[i] ?? "";
    }
    return row;
  });
}

/** Resolve the on-disk air-routes sample directory. */
export function resolveQuickstartDatasetDir(extensionRoot: string): string {
  return path.join(extensionRoot, QUICKSTART_DATASET_REL);
}

/** Load the vendored US air-routes CSVs (Apache-2.0, Kelvin R. Lawrence). */
export function loadQuickstartDataset(extensionRoot: string): QuickstartDataset {
  const datasetDir = resolveQuickstartDatasetDir(extensionRoot);
  const airportsPath = path.join(datasetDir, "airports.csv");
  const routesPath = path.join(datasetDir, "routes.csv");
  if (!fs.existsSync(airportsPath) || !fs.existsSync(routesPath)) {
    throw new Error(
      `Quickstart air-routes dataset missing under ${datasetDir} (expected airports.csv + routes.csv).`,
    );
  }

  const airports = readCsvRecords(airportsPath).map((row) => ({
    id: row.id,
    code: row.code,
    city: row.city,
    region: row.region,
    runways: Number(row.runways) || 0,
    elev: Number(row.elev) || 0,
    lat: Number(row.lat) || 0,
    lon: Number(row.lon) || 0,
  }));
  const routes = readCsvRecords(routesPath).map((row) => ({
    from: row.from,
    to: row.to,
    dist: Number(row.dist) || 0,
  }));

  if (airports.length === 0 || routes.length === 0) {
    throw new Error(`Quickstart air-routes dataset is empty under ${datasetDir}.`);
  }

  return { airports, routes, datasetDir };
}

/**
 * Build one CREATE statement that materializes the air-routes sample.
 * A single CREATE (nodes + relationships) is far faster than MATCH-per-edge.
 */
export function buildQuickstartSeedCypher(dataset: QuickstartDataset): string {
  const idToIndex = new Map<string, number>();
  const parts: string[] = [];

  dataset.airports.forEach((airport, index) => {
    idToIndex.set(airport.id, index);
    parts.push(
      `(p${index}:Airport {` +
        `id: '${escCypherString(airport.id)}', ` +
        `code: '${escCypherString(airport.code)}', ` +
        `city: '${escCypherString(airport.city)}', ` +
        `region: '${escCypherString(airport.region)}', ` +
        `runways: ${airport.runways}, ` +
        `elev: ${airport.elev}, ` +
        `lat: ${airport.lat}, ` +
        `lon: ${airport.lon}` +
        `})`,
    );
  });

  for (const route of dataset.routes) {
    const from = idToIndex.get(route.from);
    const to = idToIndex.get(route.to);
    if (from === undefined || to === undefined) {
      continue;
    }
    parts.push(`(p${from})-[:ROUTE {dist: ${route.dist}}]->(p${to})`);
  }

  return `CREATE ${parts.join(",\n")}`;
}

export function quickstartAirportCount(dataset: QuickstartDataset): number {
  return dataset.airports.length;
}

export function quickstartRouteCount(dataset: QuickstartDataset): number {
  return dataset.routes.length;
}

/**
 * Materialize the sample-owned workbench files and return the seed mutation
 * path. Query and visualization content is copied verbatim from the sample,
 * while the large CREATE mutation is generated from the vendored CSVs and
 * persisted before the engine executes it.
 */
export function materializeQuickstartProjectFiles(
  projectRoot: string,
  dataset: QuickstartDataset,
): { seedMutationPath: string } {
  const templateRoot = path.join(dataset.datasetDir, "project");
  if (!fs.existsSync(templateRoot)) {
    throw new Error(`Quickstart project template missing under ${templateRoot}.`);
  }
  fs.cpSync(templateRoot, projectRoot, { recursive: true });

  const dataRoot = path.join(projectRoot, "data", "air-routes");
  fs.mkdirSync(dataRoot, { recursive: true });
  for (const name of ["airports.csv", "routes.csv", "LICENSE", "NOTICE", "README.md"]) {
    fs.copyFileSync(path.join(dataset.datasetDir, name), path.join(dataRoot, name));
  }

  const seedMutationPath = path.join(
    projectRoot,
    PROJECT_MUTATIONS_DIR,
    "seed-air-routes.cypher",
  );
  fs.mkdirSync(path.dirname(seedMutationPath), { recursive: true });
  fs.writeFileSync(seedMutationPath, `${buildQuickstartSeedCypher(dataset)}\n`, "utf8");
  return { seedMutationPath: relativeProjectPath(projectRoot, seedMutationPath) };
}

/**
 * Add sample-owned files introduced by a newer extension without replacing
 * project results or anything the analyst has already changed.
 */
export function repairQuickstartProjectFiles(
  projectRoot: string,
  dataset: QuickstartDataset,
): string[] {
  const templateRoot = path.join(dataset.datasetDir, "project");
  if (!fs.existsSync(templateRoot)) {
    throw new Error(`Quickstart project template missing under ${templateRoot}.`);
  }

  const added: string[] = [];
  const copyMissing = (sourceDir: string, targetDir: string): void => {
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      const source = path.join(sourceDir, entry.name);
      const target = path.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(target, { recursive: true });
        copyMissing(source, target);
      } else if (entry.isFile() && !fs.existsSync(target)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
        added.push(relativeProjectPath(projectRoot, target));
      }
    }
  };

  copyMissing(templateRoot, projectRoot);
  return added.sort();
}

export function isQuickstartSamplePath(rootPath: string): boolean {
  try {
    const marker = path.join(rootPath, QUICKSTART_MARKER);
    return fs.readFileSync(marker, "utf8") === QUICKSTART_MARKER_BYTES;
  } catch {
    return false;
  }
}

export function writeQuickstartMarker(rootPath: string): void {
  fs.writeFileSync(path.join(rootPath, QUICKSTART_MARKER), QUICKSTART_MARKER_BYTES, "utf8");
}

/**
 * Resolve where to materialize the sample project.
 * Prefer an explicit path, then workspace/`graphforge-quickstart`, else tmp.
 */
export function resolveQuickstartPath(options?: {
  path?: string;
  workspaceFolder?: string;
  storageFolder?: string;
}): string {
  if (options?.path?.trim()) {
    return path.resolve(options.path.trim());
  }
  if (options?.workspaceFolder?.trim()) {
    return path.join(options.workspaceFolder.trim(), QUICKSTART_DIR_NAME);
  }
  if (options?.storageFolder?.trim()) {
    return path.join(options.storageFolder.trim(), QUICKSTART_DIR_NAME);
  }
  return path.join(os.tmpdir(), QUICKSTART_DIR_NAME);
}

/** True when the directory exists and is empty (or only contains ignored noise). */
export function isEmptyDir(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) {
    return true;
  }
  const entries = fs.readdirSync(dirPath).filter((name) => name !== ".DS_Store");
  return entries.length === 0;
}
