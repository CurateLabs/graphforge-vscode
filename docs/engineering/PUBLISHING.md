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

An external documentation site (for example a GraphForge docs-site build) must
**only** consume [`docs/published/`](../published/), never the rest of `docs/`.

- `docs/published/` — user-facing pages: install/setup (Node default, Python-prefer
  in Python-first repos, `uv` never `pip`), the command map, agent interop, and a
  marketplace overview. Kept in sync with the root `README.md` and `package.json`,
  which remain the source of truth for command IDs and settings.
- Everything else under `docs/` — contributor living docs (`PRODUCT.md`, `DESIGN.md`,
  `experience/`, `strategy/`, requirements, engineering ADRs). Readable in this
  public repo, but not Marketplace copy and not for docs-site ingestion.
- If a docs-site build ingests this repo, sync only `docs/published/*.md` (allowlist),
  not the full tree.
- This repo does not host its own documentation site; publishing here means
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
3. Restrict the Marketplace service connection to the approved `main` release branch via Azure
   DevOps branch control. That check is enforced outside YAML, so a selected branch cannot bypass
   the publishing gate.

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
6. Run the Azure pipeline with its `publish` parameter left at the default `false`. It downloads
   and verifies the release VSIXs for the `package.json` version from the GitHub release (so that
   release must already carry them; see [Release steps](#release-steps)), then runs this identity
   lookup:

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
8. On the service connection's **Approvals and checks** tab, add **Branch control** with allowed
   branch `refs/heads/main`. Do not require a manual approval click for Marketplace publishes —
   the gate is `publish: true` on an approved `main` run plus branch control.

   `main` does not currently have a GitHub branch-protection rule, so **Verify branch protection**
   is intentionally off. Enable it only after GitHub protection is configured, or all releases
   will be blocked.

The setup was proven with Azure run `20260803.2`: checks, unit tests, build, VSIX packaging, and
identity lookup passed, while the Marketplace publish task was skipped because `publish=false`.
An earlier `InvalidAccessException` with “The requested operation is not allowed” proved that the
Azure login was working but the managed identity had not yet been added as a publisher Contributor.

For recovery or rotation, recreate the managed identity/service-connection federation, rerun the
default bootstrap flow to obtain the new Marketplace resource ID, replace the publisher member,
then verify pipeline-only access and branch control before enabling a publish.

## Platform-targeted packages

Every VSIX bundles the native Core and XYG binaries of the machine that packaged it
(`scripts/package-extension.mjs` passes `vsce package --target <process.platform>-<process.arch>`).
A release therefore ships **one platform-targeted VSIX per supported platform**, each built on a
matching native runner:

| Target | GitHub runner |
| --- | --- |
| `linux-x64` | `blacksmith-4vcpu-ubuntu-2404` |
| `linux-arm64` | `ubuntu-24.04-arm` |
| `darwin-arm64` | `macos-15` |
| `darwin-x64` | `macos-15-intel` |
| `win32-x64` | `windows-latest` |

These are the same runners and packaging path as the `Packaged XYG (<platform>)` jobs in
`.github/workflows/xyg-qualification.yml`. VS Code and Open VSX serve each user the VSIX for their
platform. **No universal (untargeted) VSIX is ever published**: it would carry one platform's
native code to every platform. `scripts/verify-release-vsix.mjs` is the guard. Given a directory,
it requires exactly `graphforge-<target>.vsix` for all five targets, and checks that each one:

- declares that exact `TargetPlatform` in `extension.vsixmanifest`;
- has this checkout's `CurateLabsAI.graphforge` id and `package.json` version;
- contains that target's native Core, XYG and koffi binaries and no other target's.

With `--target <t>` it checks a single build. Both publishing pipelines run it immediately before
publishing anything.

## Local package

```bash
npm ci
npm run check && npm run compile && npm test
npm run verify:package
npm run package -- --no-dependencies -o ../graphforge-<platform>.vsix
```

This builds the VSIX for the local machine's platform only. Write it outside the worktree
(`verify:package` counts every file in the worktree). Never publish a locally built VSIX. Releases
are published only from the pipelines below.

`.github/workflows/ci.yml`'s `package` job runs `npm run package -- --no-dependencies` as a
packaging gate on every PR/push to `main` (see `TESTING.md`) and does **not** publish.

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

`.github/workflows/publish.yml` builds every release VSIX and owns Open VSX publishing. It runs on
a `v*` tag push or a manual `workflow_dispatch` (`dry_run`, default `true`):

1. **`check`** (once, Linux): a tag push fails unless `vX.Y.Z` exactly matches `package.json`.
   Then `npm ci`, type check, compile and unit tests.
2. **`package`** (matrix, one job per target on its native runner, see the table above): asserts
   the host is the expected platform, compiles, runs `verify:package`, packages
   `graphforge-<target>.vsix`, runs `verify-release-vsix.mjs --target <target>`, qualifies the
   installed package (`qualify:xyg:installed`), and uploads artifact `graphforge-vsix-<target>`.
3. **`release-set`**: downloads all five, runs `verify-release-vsix.mjs` over the set, and
   uploads them together as artifact `graphforge-release-vsix`. If any target failed or is
   missing, this job (and so publishing) never runs.
4. **`publish`**: runs every time and uses the GitHub `production` environment. It re-verifies
   the set, signs in to Pulumi with GitHub OIDC, opens the ESC environment and asks Open VSX
   whether `OVSX_PAT` may publish to the publisher namespace (`ovsx verify-pat`). A failure at any
   of those fails the job, in a dry run too, so a broken credential is found before a tag exists.
   Only for a tag push or `dry_run: false` does it then publish every VSIX to Open VSX with
   `ovsx publish --skip-duplicate` (pinned `ovsx` version). A target Open VSX already has for this
   version (`... is already published.`) counts as done for that target only. Any other failure
   fails the job after every target has been attempted, and re-running the job finishes the rest.

`azure-pipelines.yml` owns Visual Studio Marketplace publishing and **does not build**.
Microsoft-hosted Azure Pipelines agents have no Linux arm64 image, and their only macOS arm64
image (macOS 15 Sequoia ARM64) is a paused limited preview. The standard macOS images run on Intel
hardware ([Microsoft-hosted agents](https://learn.microsoft.com/en-us/azure/devops/pipelines/agents/hosted),
checked 2026-11-24). So `linux-arm64` and `darwin-arm64` cannot be built natively there, and
cross-packaging would mean shipping native code that was never run on its platform. The pipeline
therefore:

1. reads the version from `package.json` on the approved `main` it runs from;
2. downloads `graphforge-<target>.vsix` for all five targets from the GitHub release `v<version>`
   (public assets, no GitHub token);
3. runs `verify-release-vsix.mjs` over them;
4. with `publish: false` (the default), runs the identity lookup and stops. With `publish: true`,
   it publishes each VSIX with `vsce publish --packagePath <vsix> --azure-credential
   --skip-duplicate`, attempts every target, and fails naming any that did not publish.

The Marketplace and Open VSX therefore ship byte-identical, natively built and qualified packages.
The pipeline has no push or PR triggers. The service connection's branch-control check is the
authorization boundary.

GitHub releases are created by hand, as v0.1.3 was: a maintainer created the release and tag
together, and the release has no assets. No workflow creates releases or uploads to them. Attaching
the VSIXs is a manual release step (below), and the Marketplace pipeline depends on it.

The Linux x64 jobs run on Blacksmith's `blacksmith-4vcpu-ubuntu-2404` runner label (the other
platform jobs use GitHub-hosted runners), matching the other
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

If the OIDC trust isn't configured, the ESC environment doesn't exist, it doesn't define
`OVSX_PAT`, or Open VSX rejects the token, the `publish` job fails with an error naming which one —
in dry runs as well. The `release-set` artifact is still produced. (Until 0.2.0 this case only
logged a warning, and the v0.1.3 tag run reported success without publishing.)

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

### Release steps

In order, for version `X.Y.Z`:

1. **Merge the version bump** (`package.json` version and `CHANGELOG.md`) to `main`, and wait for
   `CI` and `XYG qualification` to pass on that `main` commit.
2. **Dry run (recommended):** run `Publish Open VSX` from `main` with `dry_run: true`:

   ```bash
   gh workflow run publish.yml --ref main -f dry_run=true
   ```

   Confirm all five `Package and qualify (<target>)` jobs and `Verify complete release set` pass,
   and that `Publish to Open VSX` passed its credential checks with its `Publish Open VSX via Pulumi
   ESC` step skipped. The job summary lists each file with its `TargetPlatform`.
3. **Create the GitHub release and tag** `vX.Y.Z` on that `main` commit (by hand, as before; for
   example `gh release create vX.Y.Z --target <sha> --title "GraphForge for VS Code X.Y.Z"
   --notes-file <notes>`). The tag push starts `Publish Open VSX`. It re-runs everything and,
   after `production` environment approval if one is configured, publishes all five targets to
   Open VSX.
4. **If `publish` fails part-way, re-run the failed `publish` job.** Already-published targets are
   skipped, and a failure never comes from a partial build because the set was verified first.
5. **Attach the verified VSIXs to the release**, from that tag run:

   ```bash
   run=$(gh run list --workflow publish.yml --branch vX.Y.Z --event push --limit 1 --json databaseId --jq '.[0].databaseId')
   gh run download "$run" --name graphforge-release-vsix --dir ../release-vX.Y.Z
   node scripts/verify-release-vsix.mjs ../release-vX.Y.Z
   gh release upload vX.Y.Z ../release-vX.Y.Z/graphforge-*.vsix
   ```

6. **Marketplace:** run the Azure DevOps pipeline from approved `main` (still at the tagged commit,
   or at least the same `package.json` version) with `publish: true`. It downloads those five
   release assets, verifies them, and publishes each one. A re-run skips targets that are already
   published.
7. Work through the post-publish checklist above on at least one platform per OS.

A plain dry run with `dry_run: true` publishes nothing to Open VSX (it only verifies the token), and the Azure pipeline with the default
`publish: false` never touches the Marketplace.
