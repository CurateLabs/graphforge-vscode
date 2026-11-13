import * as assert from "node:assert/strict";
import type { CliRunResult } from "../session/graphforgeCli";
import { isHubCloneFailure } from "../session/hubClone";
import {
  HUB_PUBLISH_CONTRACT,
  NO_PREVIEWS_REASON,
  bindingSupportsPublish,
  buildHubPublishArgs,
  describePublishSelection,
  interpretHubPublishResult,
  parsePublishSelection,
  prepareHubPublishRetry,
  runHubPublishRegeneration,
  publishToHub,
  requirePublishConfirmation,
} from "../session/hubPublish";

const VERSION_UUID = "0193e4f6-7b2a-7c3d-8e4f-5a6b7c8d9e0f";
const PROJECT = "/work/air-routes";

/**
 * Real `runCli(["publish", "someone/nothing", "--ref", "main", "--project", …, "--json"])`
 * stderr from @curatelabs/graphforge 0.6.0-rc.5 with no GRAPHFORGE_HUB_PUBLISH_TOKEN
 * (exit 2). Core raises it before opening the project or touching the network.
 */
const REAL_CREDENTIAL_REQUIRED = `${JSON.stringify({
  error: {
    code: "GF_VALIDATION",
    message:
      "validation error: hub.publish.auth_denied: no publish credential: set GRAPHFORGE_HUB_PUBLISH_TOKEN or run gf publish in a terminal",
    details: { source: "runtime", kind: "validation", semantic_code: "hub.publish.auth_denied" },
  },
})}\n`;

/** Receipt shape from Core's `graphforge-hub-publish/1` conformance corpus. */
function receipt(extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    format: HUB_PUBLISH_CONTRACT,
    manifest_validator: `sha256:${"a".repeat(64)}`,
    operation_uuid: "00000000-0000-7000-8000-000000000001",
    previous_revision: null,
    refs: ["main"],
    repository: { owner: "opendata", repository: "demo" },
    request_commitment: `sha256:${"b".repeat(64)}`,
    revision: `sha256:${"c".repeat(64)}`,
    ...extra,
  })}\n`;
}

function cli(exitCode: number, stdout = "", stderr = ""): CliRunResult {
  return { exitCode, stdout, stderr };
}

function coreError(code: string, message: string, semantic?: string): string {
  return `${JSON.stringify({
    error: {
      code,
      message,
      details: { source: "runtime", kind: "validation", ...(semantic ? { semantic_code: semantic } : {}) },
    },
  })}\n`;
}

suite("Hub publish (#91)", () => {
  suite("buildHubPublishArgs", () => {
    test("builds Core's publish argv with --project, --json, and the selection flag", () => {
      assert.deepEqual(
        buildHubPublishArgs({ repository: "opendata/demo", projectPath: PROJECT, ref: "main" }),
        ["publish", "opendata/demo", "--project", PROJECT, "--json", "--ref", "main"],
      );
      assert.deepEqual(
        buildHubPublishArgs({
          repository: "https://graphforge.sh/opendata/demo",
          projectPath: PROJECT,
          versionUuid: VERSION_UUID,
        }),
        ["publish", "opendata/demo", "--project", PROJECT, "--json", "--version-uuid", VERSION_UUID],
      );
    });

    test("never passes preview, notebook, app, or other file arguments", () => {
      const args = buildHubPublishArgs({ repository: "opendata/demo", projectPath: PROJECT, ref: "main", previews: [] });
      assert.ok(Array.isArray(args));
      assert.ok(!args.some((arg) => arg === "--preview"));
      assert.equal(args.length, 7);
    });

    test("validates repository, project, and selection before reaching Core", () => {
      const cases: Array<[Parameters<typeof buildHubPublishArgs>[0], string]> = [
        [{ repository: "Not A Repo", projectPath: PROJECT, ref: "main" }, "HUB_REPOSITORY_INVALID"],
        [{ repository: "https://evil.example/a/b", projectPath: PROJECT, ref: "main" }, "HUB_REPOSITORY_INVALID"],
        [{ repository: "opendata/demo", projectPath: "", ref: "main" }, "HUB_PUBLISH_PROJECT_REQUIRED"],
        [{ repository: "opendata/demo", projectPath: "--json", ref: "main" }, "HUB_PUBLISH_PROJECT_REQUIRED"],
        [{ repository: "opendata/demo", projectPath: PROJECT }, "HUB_PUBLISH_SELECTION_REQUIRED"],
        [
          { repository: "opendata/demo", projectPath: PROJECT, ref: "main", versionUuid: VERSION_UUID },
          "HUB_PUBLISH_SELECTION_CONFLICT",
        ],
        [{ repository: "opendata/demo", projectPath: PROJECT, ref: " " }, "HUB_PUBLISH_REF_INVALID"],
        [{ repository: "opendata/demo", projectPath: PROJECT, ref: "--fork-of" }, "HUB_PUBLISH_REF_INVALID"],
        [{ repository: "opendata/demo", projectPath: PROJECT, versionUuid: "v1" }, "HUB_PUBLISH_VERSION_INVALID"],
      ];
      for (const [request, code] of cases) {
        const outcome = buildHubPublishArgs(request);
        assert.ok(!Array.isArray(outcome), JSON.stringify(request));
        assert.equal(outcome.code, code, JSON.stringify(request));
        assert.ok(outcome.nextAction.length > 0);
      }
    });

    test("fails closed on any preview selection until xyg#935 and a preview-capable Core ship", () => {
      const outcome = buildHubPublishArgs({
        repository: "opendata/demo",
        projectPath: PROJECT,
        ref: "main",
        previews: ["chart.png", "chart.svg"],
      });
      assert.ok(!Array.isArray(outcome));
      assert.equal(outcome.code, "HUB_PUBLISH_PREVIEWS_UNAVAILABLE");
      assert.match(outcome.nextAction, /xyg#935/);
      assert.match(NO_PREVIEWS_REASON, /No previews yet/);
    });
  });

  suite("selection helpers", () => {
    test("a UUID is an exact Version; anything else is a Branch label", () => {
      assert.deepEqual(parsePublishSelection(` ${VERSION_UUID} `), { versionUuid: VERSION_UUID });
      assert.deepEqual(parsePublishSelection("main"), { ref: "main" });
      assert.equal(describePublishSelection({ ref: "main" }), "Branch main");
      assert.equal(describePublishSelection({ versionUuid: VERSION_UUID }), `Version ${VERSION_UUID}`);
    });
  });

  suite("requirePublishConfirmation", () => {
    test("agent calls without confirm: true fail closed with CONFIRMATION_REQUIRED", () => {
      for (const confirm of [undefined, false, "true", 1]) {
        const gate = requirePublishConfirmation(confirm, { repository: "opendata/demo", ref: "main" });
        assert.ok(gate, String(confirm));
        assert.equal(gate.code, "CONFIRMATION_REQUIRED");
        assert.match(gate.nextAction, /graphforge\.publishToHub\(.*confirm: true/);
      }
      const byVersion = requirePublishConfirmation(undefined, {
        repository: "opendata/demo",
        versionUuid: VERSION_UUID,
      });
      assert.match(byVersion?.nextAction ?? "", new RegExp(`versionUuid: "${VERSION_UUID}"`));
    });

    test("the suggested retry keeps the requested project", () => {
      const gate = requirePublishConfirmation(undefined, {
        repository: "opendata/demo",
        projectPath: PROJECT,
        ref: "main",
      });
      assert.match(gate?.nextAction ?? "", new RegExp(`projectPath: ${JSON.stringify(PROJECT)}, confirm: true`));
    });

    test("confirm: true passes", () => {
      assert.equal(requirePublishConfirmation(true, { repository: "opendata/demo", ref: "main" }), undefined);
    });
  });

  suite("interpretHubPublishResult", () => {
    test("maps the graphforge-hub-publish/1 receipt", () => {
      const outcome = interpretHubPublishResult(cli(0, receipt()));
      assert.deepEqual(outcome, {
        repository: "opendata/demo",
        refs: ["main"],
        revision: `sha256:${"c".repeat(64)}`,
        previousRevision: null,
        manifestValidator: `sha256:${"a".repeat(64)}`,
        operationUuid: "00000000-0000-7000-8000-000000000001",
        requestCommitment: `sha256:${"b".repeat(64)}`,
        previews: [],
      });
      const advanced = interpretHubPublishResult(
        cli(0, `progress\n${receipt({ previous_revision: `sha256:${"d".repeat(64)}` })}`),
      );
      assert.ok(!isHubCloneFailure(advanced));
      assert.equal(advanced.previousRevision, `sha256:${"d".repeat(64)}`);
    });

    test("rejects a success without the expected contract or fields", () => {
      for (const stdout of [
        "",
        "Published opendata/demo (main) at revision sha256:…\n",
        receipt({ format: "graphforge-hub-publish/2" }),
        receipt({ repository: "opendata/demo" }),
        receipt({ refs: "main" }),
        receipt({ revision: undefined }),
        receipt({ previous_revision: 7 }),
      ]) {
        const outcome = interpretHubPublishResult(cli(0, stdout));
        assert.ok(isHubCloneFailure(outcome), stdout);
        assert.equal(outcome.code, "HUB_PUBLISH_RECEIPT_INVALID");
      }
    });

    test("passes Core's real credential-required error through with Core's next action", () => {
      const outcome = interpretHubPublishResult(cli(2, "", REAL_CREDENTIAL_REQUIRED), "opendata/demo");
      assert.ok(isHubCloneFailure(outcome));
      assert.equal(outcome.code, "hub.publish.auth_denied");
      assert.equal(
        outcome.error,
        "validation error: hub.publish.auth_denied: no publish credential: set GRAPHFORGE_HUB_PUBLISH_TOKEN or run gf publish in a terminal",
      );
      assert.equal(
        outcome.nextAction,
        "Set GRAPHFORGE_HUB_PUBLISH_TOKEN or run gf publish in a terminal. The extension stores no Hub credential.",
      );
    });

    test("passes a future Core login action through verbatim", () => {
      const outcome = interpretHubPublishResult(
        cli(
          2,
          "",
          coreError(
            "GF_VALIDATION",
            "validation error: hub.publish.auth_denied: no saved session: run gf auth login or set GRAPHFORGE_HUB_PUBLISH_TOKEN",
            "hub.publish.auth_denied",
          ),
        ),
      );
      assert.ok(isHubCloneFailure(outcome));
      assert.match(outcome.nextAction, /^Run gf auth login or set GRAPHFORGE_HUB_PUBLISH_TOKEN\./);
    });

    test("maps Core's publish error codes, preferring the semantic code", () => {
      const cases: Array<[string, string, string | undefined, string, RegExp]> = [
        ["GF_VALIDATION", "validation error: hub.publish.auth_denied: the Hub refused the publish credential", "hub.publish.auth_denied", "hub.publish.auth_denied", /Refresh GRAPHFORGE_HUB_PUBLISH_TOKEN/],
        ["GF_VALIDATION", "validation error: hub.publish.entitlement_denied: the Hub refused the publication entitlement", "hub.publish.entitlement_denied", "hub.publish.entitlement_denied", /may publish to opendata\/demo/],
        ["GF_VALIDATION", "validation error: hub.publish.ref_conflict: the repository changed", "hub.publish.ref_conflict", "hub.publish.ref_conflict", /Publish again/],
        ["GF_TRANSACTION_CONFLICT", "hub.publish.idempotency_conflict: the operation identity was already used", undefined, "hub.publish.idempotency_conflict", /already used/],
        ["GF_VALIDATION", "validation error: hub.publish.unsupported_future: newer", "hub.publish.unsupported_future", "hub.publish.unsupported_future", /Upgrade/],
        ["GF_VALIDATION", "validation error: hub.invalid_identity: invalid repository identity", "hub.invalid_identity", "hub.invalid_identity", /owner\/repository/],
        ["GF_VALIDATION", "validation error: hub.publish.derivation: unknown branch", undefined, "hub.publish.derivation", /research Branch/],
        ["GF_STORAGE", "network unavailable", undefined, "GF_STORAGE", /network/],
      ];
      for (const [klass, message, semantic, code, nextAction] of cases) {
        const outcome = interpretHubPublishResult(cli(2, "", coreError(klass, message, semantic)), "opendata/demo");
        assert.ok(isHubCloneFailure(outcome), message);
        assert.equal(outcome.code, code, message);
        assert.equal(outcome.error, message);
        assert.match(outcome.nextAction, nextAction, message);
      }
    });

    test("reports bindings without publish as PUBLISH_UNSUPPORTED", () => {
      const bare = interpretHubPublishResult(cli(2, "", "error: unrecognized subcommand 'publish'\n"));
      assert.ok(isHubCloneFailure(bare));
      assert.equal(bare.code, "PUBLISH_UNSUPPORTED");
      assert.match(bare.nextAction, /v0\.6\.0/);
      const wrapped = interpretHubPublishResult(
        cli(2, "", coreError("GF_VALIDATION", "error: unrecognized subcommand 'publish'\n\n  tip: a similar subcommand exists: 'clone'")),
      );
      assert.ok(isHubCloneFailure(wrapped));
      assert.equal(wrapped.code, "PUBLISH_UNSUPPORTED");
    });

    test("never echoes raw output for unstructured failures", () => {
      const outcome = interpretHubPublishResult(cli(101, "Person{name:'secret'}", "thread panicked: secret row"));
      assert.ok(isHubCloneFailure(outcome));
      assert.equal(outcome.code, "HUB_PUBLISH_FAILED");
      assert.ok(!outcome.error.includes("secret"));
    });
  });

  suite("bindingSupportsPublish", () => {
    test("probes publish --help only", () => {
      const calls: string[][] = [];
      assert.equal(
        bindingSupportsPublish((args) => {
          calls.push(args);
          return cli(0, "Publish a research Branch head or exact Version to a GraphForge Hub\n");
        }),
        true,
      );
      assert.deepEqual(calls, [["publish", "--help"]]);
      assert.equal(
        bindingSupportsPublish(() => cli(2, "", "error: unrecognized subcommand 'publish'")),
        false,
      );
    });
  });

  test("publishToHub never calls Core for an invalid request", () => {
    let called = false;
    const outcome = publishToHub({ repository: "opendata/demo", projectPath: PROJECT }, () => {
      called = true;
      return cli(0, receipt());
    });
    assert.equal(called, false);
    assert.ok(isHubCloneFailure(outcome));
    assert.equal(outcome.code, "HUB_PUBLISH_SELECTION_REQUIRED");
  });

  test("publishToHub runs Core with the built argv", () => {
    let seen: string[] = [];
    const outcome = publishToHub({ repository: "opendata/demo", projectPath: PROJECT, ref: "main" }, (args) => {
      seen = args;
      return cli(0, receipt());
    });
    assert.deepEqual(seen, ["publish", "opendata/demo", "--project", PROJECT, "--json", "--ref", "main"]);
    assert.ok(!isHubCloneFailure(outcome));
    assert.equal(outcome.repository, "opendata/demo");
  });
});

/** Native rc.7 hub_publish/refusals.rs guidance; CLI JSON has no item array. */
suite("Taken-ID publish recovery (#103)", () => {
  const id = "ont_aaaaaaaaaaaaaaaa";
  const bridge = "brg_bbbbbbbbbbbbbbbb";
  const request = { repository: "alice/demo", projectPath: PROJECT, ref: "main" };
  function refusal(guidance: string) {
    const result = interpretHubPublishResult(cli(2, "", coreError(
      "GF_VALIDATION", `validation error: hub.publish.id_taken: ${guidance}`, "hub.publish.id_taken",
    )));
    assert.ok(isHubCloneFailure(result));
    return result;
  }

  test("hidden owner stays hidden, with Core's exact regenerate action", () => {
    const failure = refusal(`${id} is taken; run gf ontology regenerate-id ${id}`);
    assert.match(failure.error, new RegExp(id));
    assert.doesNotMatch(failure.error, /owner|organization/);
    assert.deepEqual(failure.actions, [{ kind: "regenerateId", id }]);
    assert.doesNotMatch(failure.nextAction, /network/);
  });

  test("visible owner is preserved without inferring organization permission", () => {
    const failure = refusal(`${bridge} is taken; publish as research, or run gf ontology regenerate-id ${bridge}`);
    assert.match(failure.error, /publish as research/);
    assert.deepEqual(failure.actions, [{ kind: "regenerateId", id: bridge }]);
  });

  test("authorized organization hint precedes other items and excludes forbidden regeneration", () => {
    const failure = refusal(`${id} is taken; run gf ontology regenerate-id ${id}\n${bridge} is taken; publish as research instead of regenerating`);
    assert.deepEqual(failure.actions, [
      { kind: "publishAsOwner", id: bridge, owner: "research" },
      { kind: "regenerateId", id },
    ]);
    const hiddenHint = refusal(`${id} is taken; publish as the owning organization instead of regenerating`);
    assert.deepEqual(hiddenHint.actions, [{ kind: "publishAsOwner", id }]);
  });

  test("unknown, stale, storage, mismatched and injected guidance never invents a mutation", () => {
    for (const guidance of [
      "the Hub refused permanent IDs; the local refusal receipt could not be saved; repair local storage and publish again before regenerating",
      `${id} was replaced by ont_cccccccccccccccc in Version ${VERSION_UUID}; publish from that regenerated Version`,
      `${id} is taken; run gf ontology regenerate-id ${bridge}`,
      `${id} is taken; run gf ontology regenerate-id ${id} --evil`,
      "ont_invalid is taken; run gf ontology regenerate-id ont_invalid",
    ]) assert.equal(refusal(guidance).actions, undefined, guidance);
    const other = interpretHubPublishResult(cli(2, "", coreError("GF_VALIDATION", `${id} is taken; run gf ontology regenerate-id ${id}`, "hub.network")));
    assert.ok(isHubCloneFailure(other));
    assert.equal(other.actions, undefined);
  });

  test("organization recovery selects an explicit repository and preserves selection without running Core", async () => {
    const retry = await prepareHubPublishRetry({ kind: "publishAsOwner", id, owner: "research" }, request, {
      chooseOwnerRepository: async suggested => { assert.equal(suggested, "research/demo"); return "research/different"; },
      confirmRegenerate: async () => assert.fail("must not ask to regenerate an organization-owned ID"),
      runCli: async () => assert.fail("must not rewrite or publish"),
    });
    assert.deepEqual(retry, { ...request, repository: "research/different" });
  });

  test("hidden organization asks without guessing its identity; cancellation changes nothing", async () => {
    const retry = await prepareHubPublishRetry({ kind: "publishAsOwner", id }, request, {
      chooseOwnerRepository: async suggested => { assert.equal(suggested, undefined); return undefined; },
      confirmRegenerate: async () => assert.fail("unexpected modal"),
      runCli: async () => assert.fail("unexpected Core call"),
    });
    assert.deepEqual(retry, { cancelled: true });
  });

  test("regeneration cancellation never calls Core", async () => {
    const retry = await prepareHubPublishRetry({ kind: "regenerateId", id }, request, {
      chooseOwnerRepository: async () => assert.fail("unexpected repository prompt"),
      confirmRegenerate: async refused => { assert.equal(refused, id); return false; },
      runCli: async () => assert.fail("cancelled regeneration must not mutate"),
    });
    assert.deepEqual(retry, { cancelled: true });
  });

  test("confirmation runs Core regeneration and retries its exact replacement Version", async () => {
    for (const selection of [{ ref: "main" }]) {
      let confirmed = false;
      let calls = 0;
      const retry = await prepareHubPublishRetry({ kind: "regenerateId", id }, {
        repository: "alice/demo", projectPath: PROJECT, ...selection,
      }, {
        chooseOwnerRepository: async () => assert.fail("unexpected repository prompt"),
        confirmRegenerate: async () => { confirmed = true; return true; },
        runCli: async argv => {
          assert.equal(confirmed, true);
          calls++;
          assert.deepEqual(argv.slice(0, 6), ["ontology", "regenerate-id", id, "--project", PROJECT, "--operation-uuid"]);
          assert.match(argv[6], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
          assert.deepEqual(argv.slice(7), ["--yes", "--json"]);
          return cli(0, JSON.stringify({ id: "ont_cccccccccccccccc", version_uuid: VERSION_UUID }));
        },
      });
      assert.equal(calls, 1);
      assert.deepEqual(retry, { repository: "alice/demo", projectPath: PROJECT, versionUuid: VERSION_UUID });
    }
  });

  test("Core refusal and an invalid success receipt prevent a publish retry", async () => {
    for (const result of [
      cli(2, "", coreError("GF_VALIDATION", "Core refuses this regeneration")),
      cli(101, "private row", "unstructured private data"),
      cli(0, "{}"),
    ]) {
      const retry = await prepareHubPublishRetry({ kind: "regenerateId", id }, request, {
        chooseOwnerRepository: async () => assert.fail("unexpected repository prompt"),
        confirmRegenerate: async () => true,
        runCli: async () => result,
      });
      assert.ok(isHubCloneFailure(retry));
      assert.doesNotMatch(retry.error, /private/);
    }
  });
  test("exact-Version recovery refuses before any prompt or Core call", async () => {
    const retry = await prepareHubPublishRetry({ kind: "regenerateId", id }, {
      repository: "alice/demo", projectPath: PROJECT, versionUuid: VERSION_UUID,
    }, {
      chooseOwnerRepository: async () => assert.fail("unexpected repository prompt"),
      confirmRegenerate: async () => assert.fail("unsupported targeting must not offer confirmation"),
      runCli: async () => assert.fail("unsupported targeting must not invoke Core"),
    });
    assert.ok(isHubCloneFailure(retry));
    assert.equal(retry.code, "HUB_ID_REGENERATION_SELECTION_UNSUPPORTED");
  });

  test("unsupported Core refuses before reading status or mutating", () => {
    for (const help of [cli(2), cli(0, "regenerate-id"), cli(0, "--expected-branch-uuid")]) {
      const calls: string[][] = [];
      const result = runHubPublishRegeneration(request, ["ontology", "regenerate-id", id], argv => {
        calls.push(argv);
        return help;
      });
      assert.ok(isHubCloneFailure(result));
      assert.equal(result.code, "HUB_ID_REGENERATION_UNSUPPORTED");
      assert.match(result.nextAction, /0\.6\.0/);
      assert.deepEqual(calls, [["ontology", "regenerate-id", "--help"]]);
    }
  });

  test("current Branch check refuses other Branches and unverified status before mutation", () => {
    for (const status of [cli(2), cli(0, "{}"), cli(0, JSON.stringify({
      label: "different", branch_uuid: VERSION_UUID, head_version_uuid: VERSION_UUID,
    }))]) {
      const calls: string[][] = [];
      const result = runHubPublishRegeneration(request, ["ontology", "regenerate-id", id], argv => {
        calls.push(argv);
        return argv.includes("--help") ? cli(0, "--expected-branch-uuid --expected-head-version-uuid") : status;
      });
      assert.ok(isHubCloneFailure(result));
      assert.deepEqual(calls, [["ontology", "regenerate-id", "--help"], ["status", "--project", PROJECT, "--json"]]);
    }
  });

  test("native mutation receives exact status expectations and preserves a raced refusal", () => {
    const branch = "0193e4f6-7b2a-7c3d-8e4f-5a6b7c8d9e1f";
    const args = ["ontology", "regenerate-id", id];
    const refusal = cli(2, "", coreError("GF_WRITE_CONFLICT", "Branch changed during preparation"));
    const calls: string[][] = [];
    const result = runHubPublishRegeneration(request, args, argv => {
      calls.push(argv);
      if (argv.includes("--help")) return cli(0, "--expected-branch-uuid --expected-head-version-uuid");
      if (argv[0] === "status") return cli(0, JSON.stringify({ label: "main", branch_uuid: branch, head_version_uuid: VERSION_UUID }));
      return refusal;
    });
    assert.deepEqual(calls[2], [...args, "--expected-branch-uuid", branch, "--expected-head-version-uuid", VERSION_UUID]);
    assert.deepEqual(result, refusal);
    assert.equal(calls.length, 3, "never fall back to an unguarded mutation");
  });

});
