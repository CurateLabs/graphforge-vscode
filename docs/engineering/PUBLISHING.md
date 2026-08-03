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
   ([Publisher management](https://marketplace.visualstudio.com/manage)). Marketplace publication
   is performed only by Azure Pipelines through the
   `graphforge-marketplace-publishing` workload-identity service connection. Its user-assigned
   managed identity must be a **Contributor** of the publisher.
2. Ensure a matching Open VSX namespace (`CurateLabsAI`) and access token exist
   ([open-vsx.org namespace docs](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions))
   as `OVSX_PAT`, likewise stored in the ESC environment.
3. Restrict the Marketplace service connection to the approved `main` release branch and add an
   Azure DevOps approval check. These are enforced outside YAML, so a selected branch cannot
   bypass the publishing gate.

### Azure DevOps workload-identity setup

The Visual Studio Marketplace path intentionally has no PAT. It uses a user-assigned Azure
managed identity, an Azure Resource Manager service connection, and workload identity federation.
These names are the durable configuration contract:

| Surface | Value |
| --- | --- |
| Azure DevOps organization/project | `CurateLabs` / `GraphForge` |
| Azure pipeline | `CurateLabs.graphforge-vscode` |
| Service connection | `graphforge-marketplace-publishing` |
| Azure resource group | `graphforge-publishing` |
| User-assigned managed identity | `graphforge-marketplace-publishing-mi` |
| Federated credential | `graphforge-marketplace-ado` |
| Azure region | `West US 2` |
| Marketplace publisher | `CurateLabsAI` |

Tenant, subscription, client, object, service-connection, issuer, subject, and Marketplace resource
IDs are not secrets, but they are deliberately not copied into this public runbook. Read them from
the live Azure and Azure DevOps resources so the runbook cannot silently drift from reality.

The one-time setup sequence is:

1. In Azure DevOps, open **Project settings → Service connections**, create an **Azure Resource
   Manager** connection using **Workload Identity Federation (manual)**, name it
   `graphforge-marketplace-publishing`, and save it as a draft. Record the generated issuer and
   subject identifier.
2. In Azure, create resource group `graphforge-publishing` and user-assigned managed identity
   `graphforge-marketplace-publishing-mi` in `West US 2`. Grant the identity **Reader** at the
   subscription scope. Reader is sufficient for the Azure CLI login; Marketplace authorization is
   granted separately.
3. On that managed identity, create federated credential `graphforge-marketplace-ado` using the
   **Other** scenario. Copy the issuer and subject from the draft service connection exactly.
4. Return to Azure DevOps and fill the service connection with the live subscription name/ID,
   tenant ID, and managed-identity client ID. Select **Verify and save**.
5. Open **Security** for the service connection. Keep **Open access** disabled and authorize only
   the `CurateLabs.graphforge-vscode` YAML pipeline. Keep the service connection shared only with
   the current `GraphForge` project.
6. Run the Azure pipeline with its `publish` parameter left at the default `false`. It installs,
   type-checks, tests, builds, packages a dependency-free VSIX, and runs this identity lookup:

   ```bash
   az rest --method get \
     --url https://app.vssps.visualstudio.com/_apis/profile/profiles/me \
     --resource 499b84ac-1321-427f-aa17-267ca6975798 \
     --query id --output tsv
   ```

   The output is the managed identity's Visual Studio Marketplace resource ID. It is different
   from the Azure client ID and Azure object ID.
7. In [Marketplace publisher management](https://marketplace.visualstudio.com/manage), open
   `CurateLabsAI` → **Members**, add that Marketplace resource ID, and assign **Contributor**.
   The resulting member may render as `<tenant-id>\\<managed-identity-object-id>`.
8. On the service connection's **Approvals and checks** tab, add:

   - **Branch control** with allowed branch `refs/heads/main`.
   - **Approvals** with David Spencer as the required approver and the instruction: “Approve only
     reviewed Visual Studio Marketplace releases from refs/heads/main.”

   `main` does not currently have a GitHub branch-protection rule, so **Verify branch protection**
   is intentionally off. Enable it only after GitHub protection is configured, or all releases
   will be blocked.

The setup was proven with Azure run `20260803.2`: checks, unit tests, build, VSIX packaging, and
identity lookup passed, while the Marketplace publish task was skipped because `publish=false`.
An earlier `InvalidAccessException` with “The requested operation is not allowed” proved that the
Azure login was working but the managed identity had not yet been added as a publisher Contributor.

For recovery or rotation, recreate the managed identity/service-connection federation, rerun the
default bootstrap flow to obtain the new Marketplace resource ID, replace the publisher member,
then verify pipeline-only access, branch control, and approval checks before enabling a publish.

## Package

```bash
npm ci
npm run check && npm run compile && npm test
npx vsce package
```

This produces `graphforge-<version>.vsix` at the repo root. Run `npm run verify:package` before
packaging. It fails when required runtime or sample files are absent, the file/size budget is
exceeded, or the package contains test, source, documentation, agent, or internal review paths.
Never publish a locally built VSIX that has not passed this contract.

`.github/workflows/ci.yml`'s `package` job already runs `npx vsce package --no-dependencies` as
a packaging gate on every PR/push to `main` (see `TESTING.md`) and uploads the `.vsix` as a
build artifact — it does **not** publish. Marketplace and Open VSX publishing are deliberately
separate: Azure Pipelines publishes the Marketplace from `main` with federated identity, while
the GitHub release workflow publishes Open VSX from a release tag or manual dispatch.

## Publish

```bash
# Visual Studio Marketplace
# Run the Azure DevOps "CurateLabs.graphforge-vscode" pipeline from approved main.
# The pipeline uses the graphforge-marketplace-publishing service connection.
npx vsce package --no-dependencies --out graphforge-marketplace.vsix
npx vsce publish --packagePath graphforge-marketplace.vsix --azure-credential

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
- Confirm the release tag (`vX.Y.Z`) resolves to the same commit that passed CI, and note the
  verified published version in the tracking issue.

## Release publishing

`azure-pipelines.yml` owns Visual Studio Marketplace publishing. It has no push or PR triggers;
run it manually from approved `main` after the PR is merged and the version has been bumped. It
defaults to a package-only bootstrap run, which prints the managed identity's Marketplace resource
ID; add that identity as a publisher Contributor once. Select `publish: true` only for an approved
release. The service connection's branch-control and approval checks are the authorization boundary.

`.github/workflows/publish.yml` owns Open VSX publishing. It has two jobs:

1. **`build`** — always runs on `push` of a `v*` tag or manual `workflow_dispatch`. Runs
   `npm ci`, type checks, unit tests, the Extension Development Host suite, the package-content
   contract, and `vsce package`, then uploads the `.vsix` as a workflow artifact. A tag build
   also fails unless `vX.Y.Z` exactly matches `package.json`.
2. **`publish`** — runs after `build` when triggered by a `v*` tag push, or by
   `workflow_dispatch` with `dry_run: false`. Uses the GitHub `production` environment for
   optional required-reviewer protection and publishes only to Open VSX.

Both jobs run on Blacksmith's `blacksmith-4vcpu-ubuntu-2404` runner label, matching the other
CurateLabs repos (`startops-nextjs`, etc.). **Blacksmith has no separate "linked publishing"
product** — linking is just installing the Blacksmith GitHub App for the `CurateLabs` org at
[app.blacksmith.sh](https://app.blacksmith.sh) so `runs-on: blacksmith-*` labels resolve to
Blacksmith-hosted runners instead of GitHub-hosted ones. Once an org is linked, every repo in it
can use Blacksmith labels; there is no additional per-repo "enable publishing" toggle to click.
If the org is not yet linked, `publish.yml` will simply queue and fail to find a runner —
link the org first (one-time, David/admin only).

### Open VSX credential is sourced from Pulumi ESC, not a raw GitHub secret

Following the pattern used by `startops-nextjs` (see
`docs/engineering/pulumi-esc-vercel-clerk-convex.md` in that repo) and the
`use-pulumi-for-platform-iac` ADR used across CurateLabs repos, the Open VSX token lives in a
Pulumi ESC environment, not as a long-lived GitHub Actions secret:

- **ESC environment:** `curatelabs/graphforge-vscode/production`
- **Values it must define:** `OVSX_PAT` (Open VSX access token), marked `fn::secret`, exported as
  `environmentVariables` so opening the environment injects them into the job environment.
- **No literal GitHub Actions secret is required.** The `publish` job authenticates to Pulumi
  Cloud with **GitHub OIDC**: the job has `permissions: id-token: write`, and
  [`pulumi/auth-actions`](https://github.com/pulumi/auth-actions) exchanges the job's
  short-lived GitHub identity token for a short-lived Pulumi Cloud organization access token.
  [`pulumi/esc-action`](https://github.com/pulumi/esc-action) then opens
  `curatelabs/graphforge-vscode/production` and injects `OVSX_PAT` into the job
  environment (values are masked in logs). There is nothing long-lived to rotate or leak, and
  the trust can be scoped in Pulumi Cloud to this repo. The earlier iteration of this workflow
  used a long-lived `PULUMI_ACCESS_TOKEN` repo secret with `pulumi env run`; that was replaced
  per the hardening recommendation on issue #20 — if a `PULUMI_ACCESS_TOKEN` secret still
  exists on the repo, it is stale and should be deleted.

If the OIDC trust isn't configured yet, the ESC environment doesn't exist, or it doesn't define
`OVSX_PAT`, the `publish` job logs a warning and skips the Open VSX publish instead of failing —
the `build` job's artifact is still produced. This lets the workflow merge and run safely before
the one-time setup below is done.

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
     ovsx:
       pat:
         fn::secret: "<paste the Open VSX access token>"
     environmentVariables:
       OVSX_PAT: ${ovsx.pat}
   ```

   Verify the projection locally before trusting CI with it:

   ```bash
   pulumi env run curatelabs/graphforge-vscode/production -- bash -c 'test -n "$OVSX_PAT" && echo ok'
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
   an extra approval gate before a real Open VSX publish.
5. **Never** print `OVSX_PAT` (or any Pulumi token) values in logs, PRs, or issues —
   only secret *names* and the ESC environment *path* should ever appear in this repo.

### Triggering a release

- **Open VSX automatic:** push a `vX.Y.Z` tag matching the `package.json` version. The `build`
  job packages, and `publish` runs immediately after (gated only by the `production`
  environment's protection rules, if any).
- **Open VSX manual dry run:** run the `Publish Open VSX` workflow via `workflow_dispatch` with
  `dry_run: true` (the default) to exercise `check`/`compile`/`test:unit`/`vsce package` and
  download the `.vsix` artifact without touching Open VSX.
- **Marketplace manual publish:** merge the version bump, then run the Azure DevOps pipeline from
  approved `main`. The first default run prints the managed identity resource ID for the one-time
  Publisher Contributor assignment. For a release, select `publish: true`; the service connection
  branch control and approval check must pass before `vsce publish --azure-credential` can run.
