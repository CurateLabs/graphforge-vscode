<!-- LLM: This folder carries the product and experience contract through the complete
engineering lifecycle. Read ../REQUIREMENTS.md first. Fill the canonical lifecycle docs,
then create focused setup guides, runbooks, API references, or operational docs only when
the project needs them. Keep the index current and remove LLM comments as you go. -->

# Engineering

Engineering begins with the shared requirements contract and follows it through design,
pre-release evidence, continuous delivery, and production learning.

## Lifecycle

| Document | Responsibility |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | How domain boundaries and system components satisfy the requirements. |
| [`TESTING.md`](TESTING.md) | How tests and CI prove the system before release. |
| [`PUBLISHING.md`](PUBLISHING.md) | How verified artifacts are versioned, promoted, deployed, and rolled back. |
| [`OBSERVABILITY.md`](OBSERVABILITY.md) | How production health and user outcomes are measured and fed back into discovery. |
| [`adrs/`](adrs/) | Why significant product and technical decisions were made. |

## Supporting documentation

<!-- LLM: Create only the focused documents this project needs. Common examples include
development setup, API/interface references, data contracts, security guides, migration
plans, and operational runbooks. Do not duplicate the canonical lifecycle docs above. -->

| Document | Description |
|---|---|
| _filename.md_ | _What it covers and who uses it_ |

## Decision records

Create the next Architecture Decision Record with:

```sh
docslime add adr <short-slug>
```

Keep the decision log in [`adrs/README.md`](adrs/README.md) synchronized with accepted,
superseded, and deprecated records.
