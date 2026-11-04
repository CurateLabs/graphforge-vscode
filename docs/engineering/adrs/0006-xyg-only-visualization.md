# ADR-0006: XYG is the sole visualization engine

- Status: Accepted
- Date: 2026-11-03
- Supersedes: ADR-0001, ADR-0003, ADR-0004, and ADR-0005's retained-renderer prerequisite

The analyst requested immediate full replacement. All visualization commands
now use XYG's canonical native composition and shared painter. The extension
bundles an exact source cohort while public packages are unavailable; source
availability replaces the earlier publication prerequisite for local integration.
This does not waive release qualification or claim public publication.

XYG owns persisted intent and the common native/WASM tick contract. The editor
owns project-bound references, original Arrow persistence, native host transport
and instance/frame coordination. No renderer choice, proprietary scene format,
legacy reader, silent layout change or alternate renderer remains.

See [the implemented contract](../XYG.md) for ownership, build, failure and
qualification details. ADR-0005's Core/XYG/Hub ownership boundaries remain valid.
