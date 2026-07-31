# Publishing

## Identity

- Publisher: `CurateLabs`
- Extension name: `graphforge`
- Fully qualified id: `CurateLabs.graphforge`
- Marketplace: [Visual Studio Marketplace](https://marketplace.visualstudio.com/) and
  [Open VSX](https://open-vsx.org/) (for VS Code-compatible editors that can't use the
  Marketplace, e.g. VSCodium, Cursor before it added Marketplace support in some
  configurations).

## Documentation publishing contract

This repo's `docs/` tree is the full [DocSlime](../PRODUCT.md) living-docs set — internal,
private-to-repo process documentation. An external documentation site (e.g. the `graphforge`
docs-site build) must **only** consume [`docs/published/`](../published/), never the rest of
this tree.

- `docs/published/` — the public, user-facing subset: install/setup (Node default,
  Python-prefer in Python-first repos, `uv` never `pip`), the command map, the agent-interop
  summary, and a marketplace overview. Kept in sync with the root `README.md` and
  `package.json`, which remain the source of truth for command IDs and settings.
- Everything else under `docs/` — `PRODUCT.md`, `DESIGN.md`, `experience/`, `strategy/`
  (if/when added), `REQUIREMENTS.md`'s FR/NFR interview format, `engineering/` ADR scaffolding
  — stays private to this repo. It is not written for an external reader and must not be
  ingested by any docs-site build.
- If a `graphforge` docs-site (or similar) build is later updated to ingest this repo, it
  should sync only from `docs/published/`, the same way `graphforge/docs-site`'s
  `scripts/sync-content.mjs` allowlists specific pages from its own `docs/` today — add
  `docs/published/*.md` from this repo to that allowlist, not the full tree.
- This repo does not build or host its own documentation site; publishing here means
  Marketplace/Open VSX packaging (below) plus keeping `docs/published/` accurate.

## One-time setup

1. Ensure the `CurateLabs` Marketplace publisher exists
   ([Publisher management](https://marketplace.visualstudio.com/manage)) and an Azure DevOps
   Personal Access Token (scope: **Marketplace → Manage**) is available as a repo/CI secret
   (e.g. `VSCE_PAT`).
2. Ensure a matching Open VSX namespace (`CurateLabs`) and access token exist
   ([open-vsx.org namespace docs](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions))
   as a secret (e.g. `OVSX_PAT`).
3. `npx vsce login CurateLabs` locally once (or rely on `VSCE_PAT` in CI — `vsce` reads it from
   the environment, no interactive login needed in CI).

## Package

```bash
npm ci
npm run check && npm run compile && npm test
npx vsce package
```

This produces `graphforge-<version>.vsix` at the repo root. Sanity-check its contents before
publishing — it should **not** contain `dist/test/**`, `src/**`, `.map` files, or `docs/**`
(enforced by `.vscodeignore`; re-check that file if the package looks bloated or the runtime
`dist/extension.js` is missing).

`.github/workflows/ci.yml`'s `package` job already runs `npx vsce package --no-dependencies` as
a packaging gate on every PR/push to `main` (see `TESTING.md`) and uploads the `.vsix` as a
build artifact — it does **not** publish. A separate release workflow (tag- or
dispatch-triggered) is expected to handle `vsce publish` / `ovsx publish` using the same
Blacksmith runner convention; land it alongside or as a follow-up to `ci.yml`.

## Publish

```bash
# Visual Studio Marketplace
npx vsce publish --pat "$VSCE_PAT"
# or, from an already-built .vsix:
npx vsce publish --packagePath graphforge-<version>.vsix --pat "$VSCE_PAT"

# Open VSX
npx ovsx publish graphforge-<version>.vsix --pat "$OVSX_PAT"
```

Bump `version` in `package.json` (semver) before each publish; `vsce`/`ovsx` both reject
republishing an existing version.

## Post-publish checklist

- Verify the listing on both the
  [Marketplace](https://marketplace.visualstudio.com/items?itemName=CurateLabs.graphforge) and
  [Open VSX](https://open-vsx.org/extension/CurateLabs/graphforge) — icon, README rendering,
  categories/keywords, repository link.
- Install from the Marketplace into a clean VS Code profile and run
  `GraphForge: Check Environment` to confirm activation and command registration work outside
  the dev tree.
- Tag the release in git (`vX.Y.Z`) and note the published version in the tracking issue.
