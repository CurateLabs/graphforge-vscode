import * as assert from "node:assert/strict";
import {
  detectProjectKind,
  EMPTY_PROJECT_KIND_SIGNALS,
  isNotebookDominant,
  type ProjectKindSignals,
} from "../session/projectKind";

function signals(overrides: Partial<ProjectKindSignals>): ProjectKindSignals {
  return { ...EMPTY_PROJECT_KIND_SIGNALS, ...overrides };
}

suite("detectProjectKind", () => {
  test("no markers at all is ambiguous", () => {
    assert.equal(detectProjectKind(signals({})), "ambiguous");
  });

  test("package.json alone is a Node project", () => {
    assert.equal(detectProjectKind(signals({ hasPackageJson: true })), "node");
  });

  test("pyproject.toml alone is a Python project", () => {
    assert.equal(detectProjectKind(signals({ hasPyproject: true })), "python");
  });

  test("uv.lock alone is a Python project", () => {
    assert.equal(detectProjectKind(signals({ hasUvLock: true })), "python");
  });

  test("requirements.txt alone is a Python project", () => {
    assert.equal(detectProjectKind(signals({ hasRequirementsTxt: true })), "python");
  });

  test(".python-version alone is a Python project", () => {
    assert.equal(detectProjectKind(signals({ hasPythonVersionFile: true })), "python");
  });

  test("Pipfile alone is a Python project", () => {
    assert.equal(detectProjectKind(signals({ hasPipfile: true })), "python");
  });

  test("environment.yml alone is a Python project", () => {
    assert.equal(detectProjectKind(signals({ hasEnvironmentYml: true })), "python");
  });

  test("setup.py alone is a Python project", () => {
    assert.equal(detectProjectKind(signals({ hasSetupPy: true })), "python");
  });

  test("notebook-dominant workspace alone is a Python project", () => {
    assert.equal(detectProjectKind(signals({ notebookDominant: true })), "python");
  });

  test("an explicitly selected VS Code Python interpreter alone is a Python project", () => {
    assert.equal(detectProjectKind(signals({ pythonInterpreterSelected: true })), "python");
  });

  test("both markers, only a weak Python signal (requirements.txt), stays ambiguous", () => {
    const kind = detectProjectKind(
      signals({ hasPackageJson: true, hasRequirementsTxt: true }),
      /* pythonGraphForgeUsable */ false,
    );
    assert.equal(kind, "ambiguous");
  });

  test("both markers, pyproject.toml present, prefers Python", () => {
    const kind = detectProjectKind(signals({ hasPackageJson: true, hasPyproject: true }), false);
    assert.equal(kind, "python");
  });

  test("both markers, uv.lock present, prefers Python", () => {
    const kind = detectProjectKind(signals({ hasPackageJson: true, hasUvLock: true }), false);
    assert.equal(kind, "python");
  });

  test("both markers, only requirements.txt but Python graphforge is usable, prefers Python", () => {
    const kind = detectProjectKind(
      signals({ hasPackageJson: true, hasRequirementsTxt: true }),
      /* pythonGraphForgeUsable */ true,
    );
    assert.equal(kind, "python");
  });

  test("both markers, no signal at all beyond package.json + requirements.txt, and graphforge unusable, is ambiguous not node", () => {
    // Ambiguous, not "node" — chooseRuntime treats ambiguous the same as node-ish
    // (Node stays default), but the classification itself should not silently
    // claim certainty it doesn't have.
    const kind = detectProjectKind(signals({ hasPackageJson: true, hasRequirementsTxt: true }));
    assert.equal(kind, "ambiguous");
  });
});

suite("isNotebookDominant", () => {
  test("no files at all is not notebook-dominant", () => {
    assert.equal(isNotebookDominant([]), false);
  });

  test("no notebooks present is not notebook-dominant", () => {
    assert.equal(isNotebookDominant(["index.ts", "package.json"]), false);
  });

  test("notebooks outnumbering other source files is notebook-dominant", () => {
    assert.equal(isNotebookDominant(["a.ipynb", "b.ipynb", "utils.py"]), true);
  });

  test("notebooks tying other source files counts as dominant", () => {
    assert.equal(isNotebookDominant(["a.ipynb", "index.ts"]), true);
  });

  test("other source files outnumbering notebooks is not notebook-dominant", () => {
    assert.equal(isNotebookDominant(["a.ipynb", "b.ts", "c.ts", "d.js"]), false);
  });

  test("is case-insensitive on extensions", () => {
    assert.equal(isNotebookDominant(["A.IPYNB"]), true);
  });
});
