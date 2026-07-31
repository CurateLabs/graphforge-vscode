import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Palette naming conventions (#41), pinned mechanically against
 * `package.json#contributes.commands`:
 *
 * - Every title carries the uniform `GraphForge: ` prefix (don't regress).
 * - Trailing `…` marks commands that open a picker/input chain before
 *   executing; zero-prompt commands don't get one.
 * - One `(Advanced)` placement convention: qualifier before the ellipsis
 *   (`Rank (Advanced)…`), never after (`Attach Evidence… (Advanced)`).
 * - Power/engineer-tier commands (`src/commands/power.ts`) carry a
 *   palette-visible `GraphForge: Power: ` segment so the analyst/integrator
 *   tiering is visible externally, matching docs/PRODUCT.md's personas.
 */

interface ContributedCommand {
  command: string;
  title: string;
}

function contributedCommands(): ContributedCommand[] {
  // dist/test/paletteTitles.test.js → repo root is two levels up.
  const packageJsonPath = path.join(__dirname, "..", "..", "package.json");
  const manifest = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    contributes: { commands: ContributedCommand[] };
  };
  return manifest.contributes.commands;
}

/** The Power/engineer command set (`src/commands/power.ts`). */
const POWER_COMMAND_IDS = [
  "graphforge.enableCapability",
  "graphforge.openWithWriteMode",
  "graphforge.exportInvocationDescriptor",
  "graphforge.listAlgorithmRuns",
  "graphforge.publishCompositeTransaction",
];

/** Analyst verbs + Find open multi-step QuickPick/input chains (#41 AC). */
const VERB_COMMAND_IDS = [
  "graphforge.rank",
  "graphforge.cluster",
  "graphforge.paths",
  "graphforge.analyze",
  "graphforge.similar",
  "graphforge.find",
];

/** Commands that execute with zero prompts must NOT carry an ellipsis. */
const ZERO_PROMPT_COMMAND_IDS = [
  "graphforge.refreshExplorer",
  "graphforge.checkEnvironment",
  "graphforge.copyEnvironmentReport",
  "graphforge.indexAdjacency",
  "graphforge.inspectAdjacency",
  "graphforge.rebuildAdjacency",
  "graphforge.listCheckpoints",
  "graphforge.embeddingSpaces",
  "graphforge.listAlgorithmRuns",
  "graphforge.listAssertions",
  "graphforge.showOntology",
  "graphforge.showResultGraph",
  "graphforge.showCapabilities",
  "graphforge.openOntologyFile",
  "graphforge.explainOntologyMode",
  "graphforge.openSettings",
  "graphforge.getStarted",
];

suite("palette titles ↔ package.json contributes.commands (#41)", () => {
  const commands = contributedCommands();
  const byId = new Map(commands.map((c) => [c.command, c.title]));

  test("every title carries the uniform GraphForge: prefix", () => {
    for (const { command, title } of commands) {
      assert.ok(title.startsWith("GraphForge: "), `${command}: missing "GraphForge: " prefix`);
    }
  });

  test("no title puts a qualifier after the ellipsis", () => {
    for (const { command, title } of commands) {
      assert.ok(
        !/…\s*\(/.test(title),
        `${command}: "${title}" uses the qualifier-after-ellipsis order — use "X (Advanced)…"`,
      );
    }
  });

  test("(Advanced) variants end with (Advanced)…", () => {
    for (const { command, title } of commands) {
      if (title.includes("(Advanced)")) {
        assert.ok(
          title.endsWith("(Advanced)…"),
          `${command}: "${title}" — the (Advanced) qualifier goes right before the trailing …`,
        );
      }
    }
  });

  test("power-tier commands carry the GraphForge: Power: segment — and only they do", () => {
    for (const id of POWER_COMMAND_IDS) {
      const title = byId.get(id);
      assert.ok(title, `${id} not contributed`);
      assert.ok(
        title.startsWith("GraphForge: Power: "),
        `${id}: "${title}" — power commands need the "GraphForge: Power: " tier cue`,
      );
    }
    for (const { command, title } of commands) {
      if (!POWER_COMMAND_IDS.includes(command)) {
        assert.ok(
          !title.includes("Power:"),
          `${command}: "${title}" — the Power tier cue is reserved for src/commands/power.ts commands`,
        );
      }
    }
  });

  test("analyst verbs and Find open multi-step chains, so they end with …", () => {
    for (const id of VERB_COMMAND_IDS) {
      const title = byId.get(id);
      assert.ok(title, `${id} not contributed`);
      assert.ok(title.endsWith("…"), `${id}: "${title}" opens a picker chain — needs trailing …`);
    }
  });

  test("zero-prompt commands do not end with …", () => {
    for (const id of ZERO_PROMPT_COMMAND_IDS) {
      const title = byId.get(id);
      assert.ok(title, `${id} not contributed`);
      assert.ok(!title.endsWith("…"), `${id}: "${title}" is zero-prompt — drop the …`);
    }
  });
});
