import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { GraphForgeSession } from "../session/graphForgeSession";
import {
  buildNodeImportCypher,
  inferImportFormat,
  parseImportRecords,
  type ImportFormat,
} from "../modules/firstParty/import/importData";
import {
  ensureProjectOrRecover,
  reportEngineError,
  withEngineProgress,
} from "./shared";

const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
const MAX_IMPORT_RECORDS = 100_000;

export interface ImportDataArgs {
  path?: string | vscode.Uri;
  format?: ImportFormat;
  label?: string;
  mode?: "create" | "merge";
  idColumn?: string;
  /** Required for non-interactive callers because import mutates the project. */
  confirm?: boolean;
}

function inputPath(value?: string | vscode.Uri): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  return value?.fsPath;
}

function suggestedLabel(filePath: string): string {
  const name = path.basename(filePath, path.extname(filePath));
  const cleaned = name.replace(/[^A-Za-z0-9_]+/g, " ").trim();
  return (
    cleaned
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join("") || "ImportedRecord"
  );
}

export function registerImportCommands(
  context: vscode.ExtensionContext,
  session: GraphForgeSession,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "graphforge.importData",
      async (args?: ImportDataArgs) => {
        const recovery = await ensureProjectOrRecover(session);
        if (recovery) return recovery;
        const interactive = args === undefined;
        let filePath = inputPath(args?.path);
        if (!filePath) {
          const selected = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { "Data files": ["csv", "json", "jsonl", "ndjson"] },
            openLabel: "Import data",
          });
          filePath = selected?.[0]?.fsPath;
        }
        if (!filePath) return { cancelled: true };

        try {
          const stat = await fs.promises.stat(filePath);
          if (!stat.isFile()) throw new Error("Import source must be a file.");
          if (stat.size > MAX_IMPORT_BYTES) {
            throw new Error("Import files are limited to 25 MB in this module version.");
          }
          const format = args?.format ?? inferImportFormat(filePath);
          const content = await fs.promises.readFile(filePath, "utf8");
          const records = parseImportRecords(content, format);
          if (records.length === 0) throw new Error("The import file contains no records.");
          if (records.length > MAX_IMPORT_RECORDS) {
            throw new Error("Imports are limited to 100,000 records in this module version.");
          }

          const label =
            args?.label?.trim() ||
            (await vscode.window.showInputBox({
              title: "GraphForge Import: Node label",
              value: suggestedLabel(filePath),
              prompt: "Every imported record becomes a node with this label.",
            }));
          if (!label) return { cancelled: true };
          const mode = args?.mode ?? "create";
          let idColumn = args?.idColumn?.trim();
          if (mode === "merge" && !idColumn) {
            idColumn = await vscode.window.showQuickPick(Object.keys(records[0]), {
              title: "GraphForge Import: Match existing nodes by",
            });
            if (!idColumn) return { cancelled: true };
          }
          if (idColumn && !Object.hasOwn(records[0], idColumn)) {
            throw new Error(`ID column ${idColumn} is not present in the first record.`);
          }

          if (interactive) {
            const choice = await vscode.window.showWarningMessage(
              `Import ${records.length.toLocaleString()} ${label} node(s) from ${path.basename(filePath)}?`,
              { modal: true, detail: "The import is applied as one GraphForge mutation." },
              "Import nodes",
            );
            if (choice !== "Import nodes") return { cancelled: true };
          } else if (args?.confirm !== true) {
            return {
              error: "Import requires explicit { confirm: true }.",
              code: "CONFIRMATION_REQUIRED",
              nextAction: "Call graphforge.importData again with confirm: true.",
            };
          }

          const cypher = buildNodeImportCypher(label, mode, idColumn);
          const result = await withEngineProgress(
            `importing ${records.length.toLocaleString()} node(s)…`,
            () => session.executeMutation(cypher, { rows: records }),
          );
          session.notifyChanged();
          void vscode.window.showInformationMessage(
            `GraphForge: imported ${records.length.toLocaleString()} ${label} node(s).`,
          );
          return {
            path: filePath,
            format,
            label,
            mode,
            idColumn,
            imported: records.length,
            result,
          };
        } catch (error) {
          return reportEngineError("import failed", error, `source: ${filePath}`);
        }
      },
    ),
  );
}

