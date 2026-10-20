import * as semver from "semver";
import pkg from "../../package.json";

/**
 * Supported-Core declaration (#95). The extension records the GraphForge Core
 * version range it was qualified against in `package.json`
 * (`graphforge.qualifiedCore`, the single source of truth, shipped inside the
 * VSIX) and checks the resolved binding against it. Kept `vscode`-free for
 * plain-mocha tests.
 *
 * Deliberately narrow (ADR 0054): this compares ONE version string against ONE
 * declared range. It does not probe capabilities, data/format versions or Hub
 * contracts - Core owns those checks (Core #1769/#1936) and their structured
 * errors reach the user untouched. Consistent with xyg#936: stable code, the
 * observed and supported versions, a next action, and no result values.
 */

/** Parseable but outside the qualified range: loadable, so warn only. */
export const CORE_VERSION_UNQUALIFIED = "CORE_VERSION_UNQUALIFIED";
/** Parseable and below the declared floor: known not to work, so refuse. */
export const CORE_VERSION_UNSUPPORTED = "CORE_VERSION_UNSUPPORTED";

export type CoreQualificationCode = typeof CORE_VERSION_UNQUALIFIED | typeof CORE_VERSION_UNSUPPORTED;

export interface QualifiedCoreDeclaration {
  /** semver range of Core versions this build was qualified against. */
  range: string;
  /** Versions below this are refused rather than warned about. */
  refuseBelow: string;
}

export const QUALIFIED_CORE: QualifiedCoreDeclaration = pkg.graphforge.qualifiedCore;

export type CoreRuntime = "node" | "python";

export interface CoreQualification {
  runtime: CoreRuntime;
  /** Observed Core version; undefined when the binding does not report one. */
  version?: string;
  qualifiedRange: string;
  status: "qualified" | "unqualified" | "unsupported";
  /** Stable code when status is not `qualified`. */
  code?: CoreQualificationCode;
  /** One line, safe for toasts and agents. */
  message?: string;
  /** What to do about it; names `graphforge.engineVersion` and the Python env route. */
  nextAction?: string;
}

/** Map PEP 440 pre-releases (`0.6.0rc5`) to semver (`0.6.0-rc.5`); other input passes through. */
export function toSemver(version: string): string | null {
  const exact = semver.valid(version);
  if (exact) {
    return exact;
  }
  const pep = /^v?(\d+\.\d+\.\d+)\.?(a|b|rc|alpha|beta)\.?(\d+)$/i.exec(version);
  if (pep) {
    const raw = pep[2].toLowerCase();
    const tag = raw === "a" ? "alpha" : raw === "b" ? "beta" : raw;
    return semver.valid(`${pep[1]}-${tag}.${pep[3]}`);
  }
  return null;
}

function nextActionFor(runtime: CoreRuntime, range: string): string {
  const install =
    runtime === "node"
      ? 'set `graphforge.engineVersion` to a version in range and run "GraphForge: Setup Native Binding"'
      : 'select a Python environment whose graphforge is in range (or set `graphforge.engineVersion` and run "GraphForge: Setup Python Binding")';
  return `Install a qualified Core (${range}): ${install}.`;
}

/**
 * Compare a resolved Core version with the declaration. Pure. Prerelease
 * semantics: `>=0.6.0-rc.5 <0.7.0` admits `0.6.0-rc.5`, `0.6.0-rc.6`, `0.6.0`
 * and `0.6.3`, but not `0.6.0-rc.4` or `0.7.0-rc.1`.
 */
export function evaluateCoreVersion(
  runtime: CoreRuntime,
  version: string | undefined | null,
  declaration: QualifiedCoreDeclaration = QUALIFIED_CORE,
): CoreQualification {
  const range = declaration.range;
  const observed = version?.trim() || undefined;
  const base = { runtime, version: observed, qualifiedRange: range };
  const nextAction = nextActionFor(runtime, range);
  const label = runtime === "node" ? "@curatelabs/graphforge" : "Python graphforge";

  const effective = observed ? toSemver(observed) : null;

  if (!observed || !effective) {
    return {
      ...base,
      status: "unqualified",
      code: CORE_VERSION_UNQUALIFIED,
      message: observed
        ? `${label} reported an unparsable version "${observed}"; cannot confirm it is within the qualified range ${range}.`
        : `${label} did not report a version; cannot confirm it is within the qualified range ${range}.`,
      nextAction,
    };
  }

  if (semver.satisfies(effective, range)) {
    return { ...base, status: "qualified" };
  }

  if (semver.lt(effective, declaration.refuseBelow)) {
    return {
      ...base,
      status: "unsupported",
      code: CORE_VERSION_UNSUPPORTED,
      message: `${label} ${observed} is older than the minimum this extension supports (${declaration.refuseBelow}); qualified range is ${range}.`,
      nextAction,
    };
  }

  return {
    ...base,
    status: "unqualified",
    code: CORE_VERSION_UNQUALIFIED,
    message: `${label} ${observed} is outside the range this extension was qualified against (${range}); it may work but is untested.`,
    nextAction,
  };
}

/** Raised when the resolved Core is refused (CORE_VERSION_UNSUPPORTED). */
export class CoreVersionError extends Error {
  readonly code: CoreQualificationCode;
  readonly nextAction: string;
  readonly qualification: CoreQualification;
  constructor(qualification: CoreQualification) {
    super(`${qualification.message ?? "Unsupported GraphForge Core version."} ${qualification.nextAction ?? ""}`.trim());
    this.name = "CoreVersionError";
    this.code = qualification.code ?? CORE_VERSION_UNSUPPORTED;
    this.nextAction = qualification.nextAction ?? "";
    this.qualification = qualification;
  }
}

/** Throw {@link CoreVersionError} for `unsupported`; return the evaluation otherwise (caller warns on `unqualified`). */
export function enforceCoreQualification(qualification: CoreQualification): CoreQualification {
  if (qualification.status === "unsupported") {
    throw new CoreVersionError(qualification);
  }
  return qualification;
}
