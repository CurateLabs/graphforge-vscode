/**
 * Arrow IPC decoding. Every read from the engine (Cypher query, analyst verb,
 * assertion page) comes back as an Arrow IPC buffer that the session layer
 * converts to plain rows before anything else can touch it, so this is on the
 * critical path of every result.
 */
import { tableFromArrays, tableToIPC } from "apache-arrow";
import type { Bench } from "tinybench";
import { bufferToUuid, decodeTable, normalizeCell } from "../session/arrowCodec";

function scalarIpcBuffer(rowCount: number): Buffer {
  const ids = new Array<string>(rowCount);
  const names = new Array<string>(rowCount);
  const counts = new BigInt64Array(rowCount);
  const scores = new Float64Array(rowCount);
  for (let index = 0; index < rowCount; index += 1) {
    ids[index] = `airport-${index}`;
    names[index] = `Airport ${index % 512}`;
    counts[index] = BigInt(index * 7);
    scores[index] = (index % 991) / 3;
  }
  const table = tableFromArrays({ id: ids, name: names, count: counts, score: scores });
  return Buffer.from(tableToIPC(table, "file"));
}

function uuidIpcBuffer(rowCount: number): Buffer {
  const uuids = new Array<Uint8Array>(rowCount);
  const labels = new Array<string>(rowCount);
  for (let index = 0; index < rowCount; index += 1) {
    const bytes = new Uint8Array(16);
    for (let byte = 0; byte < 16; byte += 1) {
      bytes[byte] = (index * 31 + byte * 7) % 256;
    }
    uuids[index] = bytes;
    labels[index] = `Entity ${index}`;
  }
  const table = tableFromArrays({ uuid: uuids, label: labels });
  return Buffer.from(tableToIPC(table, "file"));
}

export function registerArrowCodecBenchmarks(bench: Bench): void {
  const scalars = scalarIpcBuffer(5_000);
  const uuids = uuidIpcBuffer(5_000);
  const uuidBytes = Buffer.from(
    Uint8Array.from({ length: 16 }, (_, index) => index * 11),
  );
  const cells: unknown[] = [
    "already a string",
    42,
    null,
    123_456_789n,
    uuidBytes,
    new Uint8Array(uuidBytes),
  ];

  bench.add("arrowCodec: decode scalar table (5k rows x 4 cols)", () => {
    decodeTable(scalars);
  });

  bench.add("arrowCodec: decode uuid table (5k rows)", () => {
    decodeTable(uuids);
  });

  bench.add("arrowCodec: normalize 6k mixed cells", () => {
    for (let round = 0; round < 1_000; round += 1) {
      for (const cell of cells) {
        normalizeCell(cell);
      }
    }
  });

  bench.add("arrowCodec: uuid formatting (10k buffers)", () => {
    for (let index = 0; index < 10_000; index += 1) {
      bufferToUuid(uuidBytes);
    }
  });
}
