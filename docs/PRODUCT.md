# Product

GraphForge for VS Code is the editor workbench for the GraphForge embedded
knowledge-analysis engine. It exists so analysts and researchers can open a local
GraphForge project, run openCypher and first-class analyst verbs, and see ontology
plus epistemic context—not treat GraphForge as a silent graph data store.

Primary consumers work with entity graphs, citation networks, and investigation
projects as portable directories; success means they can discover and operate the
same surfaces the Python/Node APIs expose, inside VS Code.

## Problem

GraphForge’s power lives in Cypher, analyst verbs (`rank`, `cluster`, `paths`,
`analyze`, `similar`, `find`), progressive ontology, and an append-only knowledge /
epistemic layer. Without an editor surface, those capabilities stay buried in
notebooks and binding docs. Analysts need project detection, query/verb runners,
ontology visibility, and result graphs that honor class and belief status.

## Audience

- **Analysts / researchers (primary)** — open a project, query and run verbs, read
  ontology mode and types, inspect epistemic status on visualized results.
- **Integrators / maintainers (secondary)** — extend the extension against
  `@graphforge/node` without reimplementing engine semantics.

## Vision

VS Code becomes a first-class place to think with GraphForge: Cypher and analyst
verbs side by side, ontology progressive from exploratory → advisory → strict,
and result graphs that surface knowledge status instead of flattening everything
to anonymous nodes.

## Goals

- Make Cypher editing and Run Query obvious (`.cypher` / `.cql`).
- Keep analyst verbs first-class commands, not secondary to Cypher.
- Detect projects only via the exact `FORMAT` marker.
- Expose ontology mode/types and a viewer.
- Visualize results with extension-owned epistemic + class styling.
- Fail closed when the native binding is missing; never invent engine semantics.

## Quality stance

- Bindings own correctness; the extension is a thin host + UI.
- Contract-driven: project format, Arrow IPC results, ontology participant layout.
- Scaffold ships contribution points and stubs with clear extension points.

## Non-goals

- Not a multi-user graph server UI or Neo4j Browser replacement.
- Not a production force-directed renderer in v0.
- Not reimplementing Cypher, verbs, or epistemic ledgers in TypeScript.
- Not Marketplace publication as part of the initial scaffold.

## Success Metrics

- Analysts can open a project, run Cypher and at least one verb, and open ontology
  + result graph panels without leaving the editor.
- Epistemic status and ontology class appear in the result graph legend/payload.
- Contribution surface (commands, views, languages) is stable for incremental UI work.

## Stakeholders

- **Curate Labs** — publisher (`CurateLabsAI.graphforge`) and product direction.
- **GraphForge engine maintainers** — `@graphforge/node` contract owners.
- **Analyst users** — primary outcomes.
