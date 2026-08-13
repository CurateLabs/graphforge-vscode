/**
 * Engine-facing error classes, split out of `graphForgeSession.ts` so
 * `vscode`-free modules (e.g. `commands/errorPresentation.ts`) can
 * `instanceof`-check them under plain mocha (#28/#38). Re-exported from
 * `graphForgeSession.ts` so existing import sites keep working.
 */

/** Raised when the loaded @curatelabs/graphforge binding predates a given method. */
export class UnsupportedByBindingError extends Error {
  constructor(methodName: string) {
    super(
      `This @curatelabs/graphforge binding does not expose \`${methodName}()\` yet. ` +
        "The engine API may still be moving — update the binding or check the method name.",
    );
    this.name = "UnsupportedByBindingError";
  }
}

/**
 * Raised when an advanced Node-only surface (checkpoints, embedding spaces,
 * indexing, invocation descriptors, composite transactions, knowledge-ledger
 * writes) is invoked while the active session is backed by the Python
 * runtime (#12). These surfaces are deliberately out of scope for the
 * runtime-agnostic `EngineBackend` facade.
 */
export class NodeOnlyFeatureError extends Error {
  constructor(methodName: string) {
    super(
      `\`${methodName}\` requires the Node runtime (@curatelabs/graphforge). ` +
        'Switch `graphforge.runtime` to "node" (or "auto" with a Node binding available) to use this feature.',
    );
    this.name = "NodeOnlyFeatureError";
  }
}
