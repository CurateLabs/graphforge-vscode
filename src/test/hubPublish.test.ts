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
