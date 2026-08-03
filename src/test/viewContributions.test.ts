import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

interface ContributedView {
  id: string;
  visibility?: "visible" | "collapsed" | "hidden";
}

suite("GraphForge view contributions", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"),
  ) as {
    contributes: {
      views: Record<string, ContributedView[]>;
    };
  };
  const graphforgeViews = manifest.contributes.views.graphforge ?? [];
  const viewsById = new Map(graphforgeViews.map((view) => [view.id, view]));

  test("starts supporting views collapsed while keeping Get Started primary", () => {
    for (const id of [
      "graphforge.projects",
      "graphforge.ontology",
      "graphforge.knowledge",
    ]) {
      assert.equal(viewsById.get(id)?.visibility, "collapsed", `${id} should start collapsed`);
    }

    assert.equal(
      viewsById.get("graphforge.getStarted")?.visibility,
      undefined,
      "Get Started should retain the default visible state",
    );
  });
});
