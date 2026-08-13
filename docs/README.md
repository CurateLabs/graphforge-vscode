# Documentation

Living docs for **GraphForge for VS Code** (`CurateLabsAI.graphforge`).

| Document | Question it answers |
|---|---|
| [`PRODUCT.md`](PRODUCT.md) | What is this extension, who is it for, and why does it exist? |
| [`DESIGN.md`](DESIGN.md) | Consistency notes for UX and docs |
| [`experience/`](experience/) | Discovery, journeys, and agent experience |
| [`strategy/`](strategy/) | Positioning and proto-personas |
| [`REQUIREMENTS.md`](REQUIREMENTS.md) | Build contract (FR/NFR) |
| [`engineering/ARCHITECTURE.md`](engineering/ARCHITECTURE.md) | Host, session, views, webviews |
| [`engineering/TESTING.md`](engineering/TESTING.md) | How CI and focused evidence prove the extension |
| [`engineering/PUBLISHING.md`](engineering/PUBLISHING.md) | Marketplace / package path + docs-site contract |
| [`engineering/OBSERVABILITY.md`](engineering/OBSERVABILITY.md) | Current local diagnostics and telemetry boundary |
| [`published/`](published/) | User-facing docs for Marketplace readers and docs-site ingestion |

Engine product truth for GraphForge itself lives in the `graphforge` / `graphforge-nextjs` repos; this tree focuses on the VS Code workbench.

## User docs vs contributor docs

- **[`docs/published/`](published/)** — curated pages for Marketplace visitors, extension users, and coding agents. This is the only subset an external documentation site should ingest.
- **Everything else under `docs/`** — contributor and maintainer living docs (product intent, design, requirements, architecture, ADRs). Fine to read in this public repo; not written as Marketplace copy and not for docs-site sync.

See [`engineering/PUBLISHING.md`](engineering/PUBLISHING.md) for the packaging and docs-site contract.
