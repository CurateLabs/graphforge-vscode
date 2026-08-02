# GraphForge modules

GraphForge modules are installable capability manifests. Default features, a module published
through the GraphForge catalog, and a side-loaded manifest all pass through the same
`ModuleManager` install, enable, disable, and remove lifecycle. The future GraphForge catalog is
the happy path for modules not shipped in this repository; side-loading remains the advanced
local escape hatch.
The decision and its security trade-offs are recorded in
[ADR-0002](./adrs/0002-unified-module-lifecycle.md).

The default modules are `graphforge.query`, `graphforge.visualize`, and `graphforge.import`.
Their manifests and activators live under `src/modules/firstParty/`, but activation does not
bypass the module manager. They are installed with the extension on first activation, enabled
by default, and can be disabled without reloading the extension host. They cannot be removed
through the module lifecycle; modifying or deleting their packaged code is outside the supported
module contract and breaks the extension installation.

## Manifest

Every module uses `graphforge.module/v1`:

```json
{
  "format": "graphforge.module/v1",
  "id": "acme.route-tools",
  "name": "Route tools",
  "version": "1.2.0",
  "publisher": "Acme",
  "description": "Route queries and map views.",
  "capabilities": ["query", "visualize"],
  "entrypoint": {
    "kind": "commands",
    "commands": [
      {
        "capability": "query",
        "command": "acme.routes.run",
        "title": "Run route query"
      }
    ]
  }
}
```

IDs are lowercase and versions are semantic versions. Capabilities are `query`, `visualize`,
`import`, or `integration`. Unknown formats, capabilities, command IDs, and entrypoint shapes fail
closed before anything is installed. The `graphforge.*` ID namespace is reserved for built-in and
GraphForge-catalog modules; side-loaded modules use their own publisher namespace.

## Provider kinds

### GraphForge catalog (no VSIX)

The preferred boundary for modules owned by the GraphForge engine/project is the optional native
`moduleCatalog()` method. It returns an array of manifests whose entrypoint is:

```json
{
  "kind": "graphforge",
  "capabilityId": "route-analysis/v1",
  "commands": [
    {
      "capability": "query",
      "command": "graphforge.routes",
      "title": "Find routes"
    }
  ]
}
```

This lets a module live in and be registered by GraphForge without living in this extension repo
or being packaged as a VSIX. The extension treats the manifest as catalog metadata. Execution
stays in GraphForge or goes through a named command; the extension never loads engine-project
JavaScript. Bindings that predate `moduleCatalog()` return an empty catalog.

### Side-loaded manifest

**GraphForge: Install Module from File…** accepts a JSON manifest or a folder containing
`graphforge-module.json`. Side-loaded manifests may use a declarative `commands` entrypoint or,
behind the dangerous opt-in below, a `workspace-script` entrypoint. A side-loaded module cannot
claim the `builtin` or `graphforge` entrypoint.

Side-loaded modules are declarative by default. Advanced users may opt into a reviewed CommonJS
entrypoint:

```json
{
  "kind": "workspace-script",
  "script": "dist/activate.cjs"
}
```

The script must export `activate(context, host)`, using the same scoped context and host contract
as a default module. This is unsandboxed extension-host code. It is accepted only
when all of these gates pass:

1. The user-level, machine-scoped
   `graphforge.modules.dangerouslyAllowWorkspaceJavaScript` setting is `true`. A workspace setting
   cannot grant this permission.
2. VS Code reports the workspace as trusted.
3. The relative `.js` or `.cjs` path resolves inside the module folder, including after symlinks
   are resolved.
4. The user accepts a modal warning for that installation.

Turning the setting off immediately deactivates and disables installed `workspace-script`
modules. Re-enabling the setting does not silently re-enable them.

## Module manager

`GraphForge: Manage Modules` opens the Vite-built Module Bay webview. The extension host remains
the source of truth; the webview only renders state and sends install/toggle/remove/action
messages. Module state is stored in extension global state under a versioned key. Context keys
such as `graphforge.module.query.enabled` keep contributed commands and menus aligned with the
active lifecycle.

## Import module

`GraphForge: Import Data…` reads CSV, JSON arrays (or `{ "records": [...] }`), JSON Lines, and
NDJSON. It imports each object as a node with a chosen label through one parameterized Cypher
mutation. Interactive imports require a modal confirmation; command callers must pass
`{ confirm: true }`. Create is the default. Callers may request merge mode with an ID column.
The current guardrails are 25 MB and 100,000 records per atomic invocation.
