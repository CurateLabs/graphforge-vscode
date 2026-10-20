import * as assert from "node:assert/strict";
import * as semver from "semver";
import pkg from "../../package.json";
import { presentError, engineErrorCode } from "../commands/errorPresentation";
import {
  CORE_VERSION_UNQUALIFIED,
  CORE_VERSION_UNSUPPORTED,
  CoreVersionError,
  QUALIFIED_CORE,
  enforceCoreQualification,
  evaluateCoreVersion,
  toSemver,
} from "../session/coreQualification";
import { computeNextAction, coreVerdictFor, type CoreReport } from "../session/environmentReport";

suite("Supported-Core declaration (#95)", () => {
  test("is read from package.json graphforge.qualifiedCore and is a valid range", () => {
    assert.equal(QUALIFIED_CORE.range, pkg.graphforge.qualifiedCore.range);
    assert.ok(semver.validRange(QUALIFIED_CORE.range));
    assert.ok(semver.valid(QUALIFIED_CORE.refuseBelow));
  });

  test("the peerDependencies range admits the declared lower bound", () => {
    const min = semver.minVersion(QUALIFIED_CORE.range)!;
    assert.ok(
      semver.satisfies(min, pkg.peerDependencies["@curatelabs/graphforge"], { includePrerelease: true }),
    );
  });

  test("in-range versions are qualified, including the 0.6.0 prerelease line", () => {
    for (const v of ["0.6.0-rc.5", "0.6.0-rc.6", "0.6.0", "0.6.3"]) {
      const q = evaluateCoreVersion("node", v);
      assert.equal(q.status, "qualified", v);
      assert.equal(q.code, undefined);
    }
  });

  test("earlier prereleases and the next minor are out of range", () => {
    assert.equal(evaluateCoreVersion("node", "0.6.0-rc.4").status, "unqualified");
    assert.equal(evaluateCoreVersion("node", "0.7.0-rc.1").status, "unqualified");
    assert.equal(evaluateCoreVersion("node", "0.7.0").status, "unqualified");
  });

  test("loadable but unqualified warns with a stable code and next action", () => {
    const q = evaluateCoreVersion("node", "0.5.2");
    assert.equal(q.status, "unqualified");
    assert.equal(q.code, CORE_VERSION_UNQUALIFIED);
    assert.match(q.message!, /0\.5\.2/);
    assert.match(q.nextAction!, /graphforge\.engineVersion/);
    assert.equal(enforceCoreQualification(q), q);
  });

  test("below the floor is refused with CORE_VERSION_UNSUPPORTED", () => {
    const q = evaluateCoreVersion("node", "0.4.9");
    assert.equal(q.status, "unsupported");
    assert.equal(q.code, CORE_VERSION_UNSUPPORTED);
    assert.throws(
      () => enforceCoreQualification(q),
      (err: unknown) => {
        assert.ok(err instanceof CoreVersionError);
        assert.equal(err.code, CORE_VERSION_UNSUPPORTED);
        assert.match(err.message, /graphforge\.engineVersion/);
        return true;
      },
    );
  });

  test("unparsable or missing versions warn rather than refuse", () => {
    for (const v of ["banana", "", undefined, null]) {
      const q = evaluateCoreVersion("python", v);
      assert.equal(q.status, "unqualified");
      assert.equal(q.code, CORE_VERSION_UNQUALIFIED);
      assert.match(q.nextAction!, /Python environment/);
    }
  });

  test("PEP 440 prereleases from PyPI map onto the same range", () => {
    assert.equal(toSemver("0.6.0rc5"), "0.6.0-rc.5");
    assert.equal(toSemver("0.6.0b1"), "0.6.0-beta.1");
    assert.equal(evaluateCoreVersion("python", "0.6.0rc5").status, "qualified");
    assert.equal(evaluateCoreVersion("python", "0.6.0rc4").status, "unqualified");
  });

  test("a custom declaration is honored", () => {
    const decl = { range: ">=0.5.0 <0.6.0", refuseBelow: "0.5.0" };
    assert.equal(evaluateCoreVersion("node", "0.5.1", decl).status, "qualified");
    assert.equal(evaluateCoreVersion("node", "0.4.0", decl).status, "unsupported");
  });

  test("the refusal presents as an error with its code", () => {
    const err = new CoreVersionError(evaluateCoreVersion("node", "0.4.9"));
    assert.equal(engineErrorCode(err), CORE_VERSION_UNSUPPORTED);
    const presented = presentError(err);
    assert.equal(presented.severity, "error");
    assert.equal(presented.code, CORE_VERSION_UNSUPPORTED);
    assert.equal(presented.setup, false);
  });

  test("environment next action leads with the Core verdict only when not qualified", () => {
    const warn = evaluateCoreVersion("node", "0.5.2");
    assert.match(computeNextAction(true, false, true, "node", warn), /^\[CORE_VERSION_UNQUALIFIED\]/);
    const ok = evaluateCoreVersion("node", "0.6.0");
    assert.match(computeNextAction(true, false, true, "node", ok), /Ready/);
  });

  test("with no project open, the runtime that would be selected supplies the verdict", () => {
    const refused = evaluateCoreVersion("node", "0.4.9");
    const core: CoreReport = { declared: QUALIFIED_CORE, node: refused };
    assert.equal(coreVerdictFor(core, "none", "node"), refused);
    assert.equal(coreVerdictFor(core, "none", undefined), undefined);
    assert.equal(coreVerdictFor(core, "python", "node"), undefined);
    // A refused open must not be answered with "open a project" again.
    const action = computeNextAction(true, false, false, "none", coreVerdictFor(core, "none", "node"));
    assert.match(action, /^\[CORE_VERSION_UNSUPPORTED\]/);
    assert.doesNotMatch(action, /Open Project/);
  });
});
