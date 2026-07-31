# GraphForge for VS Code — published docs

This directory (`docs/published/`) is the **only** part of this repository's documentation
tree that is meant to be ingested by an external documentation site (e.g. the `graphforge`
docs-site build). Everything else under `docs/` — `PRODUCT.md`, `DESIGN.md`, `experience/`,
`strategy/`, `REQUIREMENTS.md`, `engineering/` ADR scaffolding, and similar living/DocSlime
documents — is **internal, private-to-repo** process documentation for the people and agents
building this extension. It is not user-facing and should never be published externally.

See [`docs/engineering/PUBLISHING.md`](../engineering/PUBLISHING.md) for the full contract
this split enforces.

## What's here

| Document | Question it answers |
|---|---|
| [`overview.md`](overview.md) | What is the GraphForge VS Code extension, and why would I install it? |
| [`install.md`](install.md) | How do I get a runtime (Node or Python) working, and how does `auto` choose one? |
| [`commands.md`](commands.md) | What commands does the extension register, and what does each one do? |
| [`agent-interop.md`](agent-interop.md) | How does a coding agent (Cursor, Copilot Agent Mode, etc.) drive the extension programmatically? |

## Authoring rules for this subset

- Write for an external reader (a Marketplace visitor, an extension user, or an agent) —
  no internal issue-tracker narrative, no DocSlime section templates (`Observed need`,
  `Given/When/Then`, `Open questions`, etc.), no references to internal branches or worktrees.
- Keep it in sync with the root [`README.md`](../../README.md) and `package.json` — those are
  the source of truth for command IDs, settings, and setup steps; this subset is a
  docs-site-friendly restatement, not a divergent copy.
- Any new page added here must also be added to `docs/README.md`'s doc map and, if the
  `graphforge` docs-site build is updated to ingest this repo, to that build's page allowlist.
