# Documentation

Living docs for **GraphForge for VS Code** (`CurateLabs.graphforge`).

| Document | Question it answers |
|---|---|
| [`PRODUCT.md`](PRODUCT.md) | What is this extension, who is it for, and why does it exist? |
| [`DESIGN.md`](DESIGN.md) | Consistency notes for UX and docs |
| [`experience/`](experience/) | Discovery and journeys (fill as evidence arrives) |
| [`REQUIREMENTS.md`](REQUIREMENTS.md) | Build contract (FR/NFR) |
| [`engineering/ARCHITECTURE.md`](engineering/ARCHITECTURE.md) | Host, session, views, webviews |
| [`engineering/TESTING.md`](engineering/TESTING.md) | How we prove the scaffold |
| [`engineering/PUBLISHING.md`](engineering/PUBLISHING.md) | Marketplace / package path + published-docs contract |
| [`engineering/OBSERVABILITY.md`](engineering/OBSERVABILITY.md) | Runtime signals (later) |
| [`published/`](published/) | The public, user-facing subset of these docs — see below |

Engine product truth for GraphForge itself lives in the `graphforge` / `graphforge-nextjs` repos; this tree focuses on the VS Code workbench.

## Published vs. internal docs

Everything under `docs/` in this repo is the full DocSlime living-docs tree — internal,
private-to-repo process documentation for the people (and agents) building this extension.

**[`docs/published/`](published/)** is the one exception: a small, deliberately curated,
external-reader-facing subset (install/setup, command map, agent interop, marketplace
overview) suitable for md ingestion by an external documentation site, e.g. the `graphforge`
docs-site build. Nothing else in this tree — `PRODUCT.md`, `experience/`, `strategy/`,
`REQUIREMENTS.md`'s interview template, ADR scaffolding, etc. — is meant to be published
externally. See [`engineering/PUBLISHING.md`](engineering/PUBLISHING.md) for the full contract.
