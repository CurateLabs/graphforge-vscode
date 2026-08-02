# Architecture Decision Records

An **Architecture Decision Record (ADR)** captures one significant decision — the context,
the choice made, and its consequences — so the reasoning lives in the repo alongside the
code. Decisions are immutable once accepted: to change one, add a new ADR that supersedes it.

## Creating an ADR

```
docslime add adr <short-slug>
```

This creates the next-numbered record, e.g. `0001-<short-slug>.md`. Fill it in (the file
carries inline guidance), then add a row to the log below.

## Status values

- **Proposed** — under discussion.
- **Accepted** — decided and in effect.
- **Superseded by ADR-NNNN** — replaced by a later decision.
- **Deprecated** — no longer relevant.

## Decision log

| ADR | Title | Status | Date |
|---|---|---|---|
| [0001](./0001-plotly-figure-webview-csp.md) | Plotly Figure webview under Settings-strict CSP | Accepted | 2026-08-01 |
| [0002](./0002-unified-module-lifecycle.md) | Catalog-first unified module lifecycle | Accepted | 2026-08-02 |
