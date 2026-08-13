# GraphForge for VS Code — published docs

This directory is the curated, user-facing documentation subset. An external
documentation site (for example a GraphForge docs-site build) should ingest
**only** these pages—not the rest of `docs/`.

Contributor docs (`PRODUCT.md`, `DESIGN.md`, `experience/`, `strategy/`,
`REQUIREMENTS.md`, engineering ADRs, and similar) live elsewhere under `docs/`
for maintainers and contributors. They are not Marketplace copy.

See [`docs/engineering/PUBLISHING.md`](../engineering/PUBLISHING.md) for the full
contract.

## What's here

| Document | Question it answers |
|---|---|
| [`overview.md`](overview.md) | What is the GraphForge VS Code extension, and why would I install it? |
| [`install.md`](install.md) | How do I get a runtime (Node or Python) working, and how does `auto` choose one? |
| [`commands.md`](commands.md) | What commands does the extension register, and what does each one do? |
| [`agent-interop.md`](agent-interop.md) | How does a coding agent drive the extension programmatically? |

## Authoring rules for this subset

- Write for an external reader (Marketplace visitor, extension user, or agent) —
  no internal issue-tracker narrative, no DocSlime section templates
  (`Observed need`, `Given/When/Then`, `Open questions`, etc.).
- Keep it in sync with the root [`README.md`](../../README.md) and `package.json` —
  those are the source of truth for command IDs, settings, and setup steps.
- Any new page added here must also be listed in `docs/README.md` and, if a
  docs-site build ingests this repo, on that build's page allowlist.
