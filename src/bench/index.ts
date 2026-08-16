/**
 * CodSpeed benchmark entrypoint.
 *
 * Built by `vite build --mode bench` into a CJS bundle (dist/bench/index.js)
 * the same way the mocha unit tests are built, so benchmarks exercise the same
 * bundled shape as the shipped extension host code. Nothing here may import
 * `vscode`: benchmarks run in a plain Node process.
 *
 *   npm run bench                       # plain tinybench run
 *   codspeed run -m simulation -- npm run bench:run
 */
import { withCodSpeed } from "@codspeed/tinybench-plugin";
import { Bench } from "tinybench";
import { registerArrowCodecBenchmarks } from "./arrowCodec.bench";
import { registerFigureBenchmarks } from "./figures.bench";
import { registerResultGraphBenchmarks } from "./resultGraph.bench";
import { registerResultTableBenchmarks } from "./resultTable.bench";

async function main(): Promise<void> {
  const bench = withCodSpeed(new Bench({ name: "graphforge", throws: true }));

  registerArrowCodecBenchmarks(bench);
  registerFigureBenchmarks(bench);
  registerResultGraphBenchmarks(bench);
  registerResultTableBenchmarks(bench);

  await bench.run();
  console.table(bench.table());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
