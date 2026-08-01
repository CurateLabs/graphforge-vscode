# Publishing

## Identity

- Publisher: `CurateLabsAI`
- Extension name: `graphforge`
- Fully qualified id: `CurateLabsAI.graphforge`
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

1. Ensure the `CurateLabsAI` Marketplace publisher exists
   ([Publisher management](https://marketplace.visualstudio.com/manage)) and an Azure DevOps
   Personal Access Token (scope: **Marketplace → Manage**) is available to CI as `VSCE_PAT` —
   stored in the Pulumi ESC environment, not as a raw GitHub secret (see "CI publishing" below).
2. Ensure a matching Open VSX namespace (`CurateLabsAI`) and access token exist
   ([open-vsx.org namespace docs](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions))
   as `OVSX_PAT`, likewise stored in the ESC environment.
3. `npx vsce login CurateLabsAI` locally once (or rely on `VSCE_PAT` in CI — `vsce` reads it from
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
  [Marketplace](https://marketplace.visualstudio.com/items?itemName=CurateLabsAI.graphforge) and
  [Open VSX](https://open-vsx.org/extension/CurateLabsAI/graphforge) — icon, README rendering,
  categories/keywords, repository link.
- Install from the Marketplace into a clean VS Code profile and run
  `GraphForge: Check Environment` to confirm activation and command registration work outside
  the dev tree.
- Tag the release in git (`vX.Y.Z`) and note the published version in the tracking issue.

## CI publishing (Blacksmith runners + Pulumi ESC)

`.github/workflows/publish.yml` automates the package/publish steps above. It has two jobs:

1. **`build`** — always runs on `push` of a `v*` tag or manual `workflow_dispatch`. Runs
   `npm ci`, `npm run check`, `npm run compile`, `npm run test:unit`, then `vsce package` and
   uploads the `.vsix` as a workflow artifact. This job needs no secrets and is safe to run at
   any time (package-only dry run).
2. **`publish`** — runs after `build` when triggered by a `v*` tag push, or by
   `workflow_dispatch` with `dry_run: false`. Uses the GitHub `production` environment for
   optional required-reviewer protection.

Both jobs run on Blacksmith's `blacksmith-4vcpu-ubuntu-2404` runner label, matching the other
CurateLabs repos (`startops-nextjs`, etc.). **Blacksmith has no separate "linked publishing"
product** — linking is just installing the Blacksmith GitHub App for the `CurateLabs` org at
[app.blacksmith.sh](https://app.blacksmith.sh) so `runs-on: blacksmith-*` labels resolve to
Blacksmith-hosted runners instead of GitHub-hosted ones. Once an org is linked, every repo in it
can use Blacksmith labels; there is no additional per-repo "enable publishing" toggle to click.
If the org is not yet linked, `publish.yml` will simply queue and fail to find a runner —
link the org first (one-time, David/admin only).

### Secrets are sourced from Pulumi ESC, not raw GitHub secrets

Following the pattern used by `startops-nextjs` (see
`docs/engineering/pulumi-esc-vercel-clerk-convex.md` in that repo) and the
`use-pulumi-for-platform-iac` ADR used across CurateLabs repos, the Marketplace/Open VSX PATs
live in a Pulumi ESC environment, not as long-lived GitHub Actions secrets:

- **ESC environment:** `curatelabs/graphforge-vscode/production`
- **Values it must define:** `VSCE_PAT` (Azure DevOps PAT, Marketplace → Manage scope) and
  `OVSX_PAT` (Open VSX access token), each marked `fn::secret`, exported as
  `environmentVariables` so opening the environment injects them into the job environment.
- **No literal GitHub Actions secret is required.** The `publish` job authenticates to Pulumi
  Cloud with **GitHub OIDC**: the job has `permissions: id-token: write`, and
  [`pulumi/auth-actions`](https://github.com/pulumi/auth-actions) exchanges the job's
  short-lived GitHub identity token for a short-lived Pulumi Cloud organization access token.
  [`pulumi/esc-action`](https://github.com/pulumi/esc-action) then opens
  `curatelabs/graphforge-vscode/production` and injects `VSCE_PAT`/`OVSX_PAT` into the job
  environment (values are masked in logs). There is nothing long-lived to rotate or leak, and
  the trust can be scoped in Pulumi Cloud to this repo. The earlier iteration of this workflow
  used a long-lived `PULUMI_ACCESS_TOKEN` repo secret with `pulumi env run`; that was replaced
  per the hardening recommendation on issue #20 — if a `PULUMI_ACCESS_TOKEN` secret still
  exists on the repo, it is stale and should be deleted.

If the OIDC trust isn't configured yet, the ESC environment doesn't exist, or it doesn't define
`VSCE_PAT`/`OVSX_PAT`, the `publish` job logs a warning and skips the actual
`vsce publish`/`ovsx publish` calls instead of failing — the `build` job's artifact is still
produced. This lets the workflow merge and run safely before the one-time setup below is done.

### One-time setup for David

1. **Link Blacksmith** (if not already done for another repo's CI): sign in at
   [app.blacksmith.sh](https://app.blacksmith.sh) with a `CurateLabs` org member, install the
   Blacksmith GitHub App on the `CurateLabs` org (or just this repo), and grant it access to
   `graphforge-vscode`.
2. **Create the Pulumi ESC environment** (requires the Pulumi CLI and a `curatelabs` Pulumi
   Cloud org login):

   ```bash
   esc env init curatelabs/graphforge-vscode/production
   esc env edit curatelabs/graphforge-vscode/production
   ```

   Paste (adjust org name if `curatelabs` differs from what's already used for other CurateLabs
   Pulumi environments):

   ```yaml
   values:
     vsce:
       pat:
         fn::secret: "<paste the Azure DevOps Marketplace PAT>"
     ovsx:
       pat:
         fn::secret: "<paste the Open VSX access token>"
     environmentVariables:
       VSCE_PAT: ${vsce.pat}
       OVSX_PAT: ${ovsx.pat}
   ```

   Verify the projection locally before trusting CI with it:

   ```bash
   pulumi env run curatelabs/graphforge-vscode/production -- bash -c 'test -n "$VSCE_PAT" && test -n "$OVSX_PAT" && echo ok'
   ```

3. **Register GitHub Actions as an OIDC issuer in Pulumi Cloud** (one-time, replaces minting a
   long-lived `PULUMI_ACCESS_TOKEN`). In Pulumi Cloud, as a `curatelabs` org admin:

   1. Go to **Organization settings → OIDC issuers → Register issuer** (docs:
      [Configuring OpenID Connect for GitHub](https://www.pulumi.com/docs/administration/access-identity/oidc-issuers/github/)).
   2. Name it (e.g. `github-actions`) and set the issuer URL to
      `https://token.actions.githubusercontent.com`.
   3. Add an authorization policy: **Decision** `Allow`, **Token type** `Organization`,
      **Aud** `urn:pulumi:org:curatelabs`, **Sub** `repo:CurateLabs/graphforge-vscode:*`.
      The `Sub` claim scopes the trust to this repo only; tighten it further to
      `repo:CurateLabs/graphforge-vscode:environment:production` if you want tokens issued
      only to jobs running in the `production` GitHub Environment (the publish job qualifies).

   No `gh secret set` is needed — the workflow's `pulumi/auth-actions` step exchanges the
   job's OIDC token for a short-lived Pulumi token at run time. If a `PULUMI_ACCESS_TOKEN`
   repo secret was previously added, delete it once the OIDC path is verified:

   ```bash
   gh secret delete PULUMI_ACCESS_TOKEN --repo CurateLabs/graphforge-vscode
   ```

4. **Create the `production` GitHub Environment** (Settings → Environments → New environment,
   name it `production`) so the `publish` job's `environment: production` reference resolves.
   Optionally add required reviewers or restrict deployment to the `main` branch/`v*` tags for
   an extra approval gate before a real Marketplace/Open VSX publish.
5. **Never** print `VSCE_PAT`/`OVSX_PAT` (or any Pulumi token) values in logs, PRs, or issues —
   only secret *names* and the ESC environment *path* should ever appear in this repo.

### Triggering a release

- **Automatic:** push a `vX.Y.Z` tag matching the `package.json` version. The `build` job packages,
  and `publish` runs immediately after (gated only by the `production` environment's protection
  rules, if any).
- **Manual dry run:** run the `Publish Extension` workflow via `workflow_dispatch` with
  `dry_run: true` (the default) to exercise `check`/`compile`/`test:unit`/`vsce package` and
  download the `.vsix` artifact without touching the Marketplace or Open VSX.
- **Manual publish:** run `workflow_dispatch` with `dry_run: false` to publish outside of a tag
  push (e.g. re-publishing after a failed run).
