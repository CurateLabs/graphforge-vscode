import { execFile } from "node:child_process";

const PROBE_TIMEOUT_MS = 5000;

export interface GraphForgeImportProbe {
  ok: boolean;
  version?: string;
  error?: string;
}

/**
 * Spawn `interpreterPath -c "import graphforge…"` with a bounded timeout.
 * Kept free of `vscode` (split out of `pythonLoader.ts`) so it is unit
 * testable directly under plain mocha, same convention as
 * `environmentReport.ts` / `arrowCodec.ts` / `runtimeSelection.ts`.
 */
export function probeGraphForgeImport(interpreterPath: string): Promise<GraphForgeImportProbe> {
  const script =
    "import json,sys\n" +
    "try:\n" +
    "    import graphforge\n" +
    "except Exception as e:\n" +
    "    print(json.dumps({'ok': False, 'error': f'{type(e).__name__}: {e}'}))\n" +
    "    sys.exit(0)\n" +
    "print(json.dumps({'ok': True, 'version': getattr(graphforge, '__version__', None)}))\n";

  return new Promise((resolve) => {
    execFile(
      interpreterPath,
      ["-c", script],
      { timeout: PROBE_TIMEOUT_MS },
      (err, stdout, stderr) => {
        if (err) {
          resolve({
            ok: false,
            error: stderr?.trim() || err.message,
          });
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim().split("\n").pop() ?? "{}");
          if (parsed.ok) {
            resolve({ ok: true, version: parsed.version ?? undefined });
          } else {
            resolve({ ok: false, error: parsed.error ?? "import failed" });
          }
        } catch (parseErr) {
          resolve({
            ok: false,
            error: `unparseable probe output: ${
              parseErr instanceof Error ? parseErr.message : String(parseErr)
            }`,
          });
        }
      },
    );
  });
}
