# ADR-0002: Catalog-first unified module lifecycle

- Status: Accepted
- Date: 2026-08-02

## Context

GraphForge needs Query and Visualize to be independently manageable, needs a
first-party Import capability, and must support modules that do not live in this
repository. A module may ship here, be published by the GraphForge project through
its catalog, or be side-loaded by an advanced user.

Separate registries for each source would make installation state, command
availability, UI, and cleanup depend on where a capability happened to be
packaged. Treating side-loaded files as executable extension bundles would also
turn a local manifest into an implicit workspace-code execution grant.

## Decision

1. Every module uses the versioned `graphforge.module/v1` manifest and declares
   its identity, publisher, version, capabilities, and entrypoint.
2. One extension-owned `ModuleManager` validates manifests and owns discovery,
   installation, enablement, activation, deactivation, status, persistence, and
   the state rendered by Module Bay.
3. First-party modules use the same manager and manifests as catalog and
   side-loaded modules.
   They are installed and enabled on first activation, may be disabled, and
   cannot be removed.
4. Providers remain explicit: default, GraphForge catalog, and side-load. The
   provider is provenance; the capability (`query`,
   `visualize`, `import`, or `integration`) is behavior.
5. The optional native `moduleCatalog()` method is the discovery boundary for
   modules registered by the GraphForge project. Missing support is compatible
   and produces an empty catalog.
6. The GraphForge catalog is the sole normal distribution path for externally
   developed modules.
7. Side-loaded modules are the advanced/local escape hatch and are declarative by
   default. An explicit `workspace-script`
   entrypoint is permitted only behind a machine-scoped dangerous user setting,
   VS Code Workspace Trust, contained path validation, and a per-install modal
   confirmation. The workspace cannot enable this permission for itself.

## Consequences

- Module Bay can present default, catalog, and side-loaded capabilities in one inventory
  and apply the same install/toggle/remove language to every eligible module.
- A module can be owned and registered by GraphForge without being packaged as a
  VSIX or copied into this repository.
- Engine catalog execution semantics stay owned by GraphForge; the extension
  owns manifest validation, lifecycle, persistence, and presentation.
- Older bindings remain usable, but expose no engine catalog entries.
- Declarative side-loading remains the safe default. Advanced users can accept
  unsandboxed extension-host execution for reviewed local code, but the explicit
  gates make that authority visible and prevent repository-controlled opt-in.
- Future manifest changes require a new format version or an explicitly backward-
  compatible extension of `graphforge.module/v1`.
