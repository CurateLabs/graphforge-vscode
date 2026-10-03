import * as assert from "node:assert/strict";
import type { CliRunResult } from "../session/graphforgeCli";
import {
  HUB_CLONE_CONTRACT,
  buildHubCloneArgs,
  cloneFromHub,
  interpretHubCloneResult,
  isHubCloneFailure,
  parseHubCloneUriQuery,
  parseHubRepository,
} from "../session/hubClone";

const VERSION_UUID = "0193e4f6-7b2a-7c3d-8e4f-5a6b7c8d9e0f";

function receipt(extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    contract: HUB_CLONE_CONTRACT,
    repository: "openalex/openalex",
    destination: "/tmp/openalex",
    immutable_version: `sha256:${"a".repeat(64)}`,
    package_digest: `sha256:${"b".repeat(64)}`,
    generation_uuid: "0193e4f6-0000-7000-8000-000000000001",
    resumed_bytes: 0,
    ...extra,
  })}\n`;
}

function cli(exitCode: number, stdout = "", stderr = ""): CliRunResult {
  return { exitCode, stdout, stderr };
}

suite("Hub clone (#88)", () => {
  suite("parseHubRepository", () => {
    test("accepts owner/repo and canonical graphforge.sh URLs", () => {
      assert.deepEqual(parseHubRepository("openalex/openalex"), {
        owner: "openalex",
        repository: "openalex",
      });
      assert.deepEqual(parseHubRepository(" https://graphforge.sh/acme/air-routes.v2/ "), {
        owner: "acme",
        repository: "air-routes.v2",
      });
    });

    test("rejects other hosts, uppercase, traversal, and extra segments", () => {
      for (const input of [
        "",
        "openalex",
        "Owner/repo",
        "a/b/c",
        "../etc",
        "owner/..",
        "owner/-repo",
        "http://graphforge.sh/a/b",
        "https://evil.example/a/b",
        "https://graphforge.sh/a/b?x=1",
        `owner/${"r".repeat(101)}`,
      ]) {
        assert.equal(parseHubRepository(input), undefined, input);
      }
    });
  });

  suite("parseHubCloneUriQuery", () => {
    test("maps repository, ref, and version", () => {
      assert.deepEqual(parseHubCloneUriQuery("repository=openalex%2Fopenalex&ref=main"), {
        repository: "openalex/openalex",
        ref: "main",
      });
      assert.deepEqual(
        parseHubCloneUriQuery(`repository=https%3A%2F%2Fgraphforge.sh%2Fa%2Fb&version=${VERSION_UUID}`),
        { repository: "a/b", versionUuid: VERSION_UUID },
      );
    });

    test("fails closed on malformed links before reaching Core", () => {
      const missing = parseHubCloneUriQuery("");
      assert.ok(isHubCloneFailure(missing));
      assert.equal(missing.code, "HUB_REPOSITORY_INVALID");

      const both = parseHubCloneUriQuery(`repository=a/b&ref=main&version=${VERSION_UUID}`);
      assert.ok(isHubCloneFailure(both));
      assert.equal(both.code, "HUB_CLONE_SELECTION_CONFLICT");

      const flag = parseHubCloneUriQuery("repository=a/b&ref=--json");
      assert.ok(isHubCloneFailure(flag));
      assert.equal(flag.code, "HUB_CLONE_REF_INVALID");

      const badVersion = parseHubCloneUriQuery("repository=a/b&version=nope");
      assert.ok(isHubCloneFailure(badVersion));
      assert.equal(badVersion.code, "HUB_CLONE_VERSION_INVALID");
    });
  });

  suite("buildHubCloneArgs", () => {
    test("builds Core's clone argv with --json and the selection flag", () => {
      assert.deepEqual(
        buildHubCloneArgs({
          repository: "https://graphforge.sh/openalex/openalex",
          destination: "/tmp/openalex",
          ref: "main",
        }),
        ["clone", "openalex/openalex", "/tmp/openalex", "--json", "--ref", "main"],
      );
      assert.deepEqual(
        buildHubCloneArgs({ repository: "a/b", destination: "/tmp/b", versionUuid: VERSION_UUID }),
        ["clone", "a/b", "/tmp/b", "--json", "--version-uuid", VERSION_UUID],
      );
    });

    test("requires a destination that cannot be read as a flag", () => {
      for (const destination of ["", "--telemetry-endpoint"]) {
        const outcome = buildHubCloneArgs({ repository: "a/b", destination });
        assert.ok(!Array.isArray(outcome));
        assert.equal(outcome.code, "HUB_CLONE_DESTINATION_REQUIRED");
      }
    });
  });

  suite("interpretHubCloneResult", () => {
    test("maps the graphforge-hub-clone/1 receipt", () => {
      assert.deepEqual(
        interpretHubCloneResult(
          cli(0, receipt({ research_version_uuid: VERSION_UUID, research_version_kind: "branch_head" })),
        ),
        {
          repository: "openalex/openalex",
          destination: "/tmp/openalex",
          immutableVersion: `sha256:${"a".repeat(64)}`,
          packageDigest: `sha256:${"b".repeat(64)}`,
          generationUuid: "0193e4f6-0000-7000-8000-000000000001",
          researchVersionUuid: VERSION_UUID,
          researchVersionKind: "branch_head",
        },
      );
    });

    test("rejects a success without the expected contract", () => {
      const outcome = interpretHubCloneResult(cli(0, receipt({ contract: "graphforge-hub-clone/2" })));
      assert.ok(isHubCloneFailure(outcome));
      assert.equal(outcome.code, "HUB_CLONE_RECEIPT_INVALID");
    });

    test("reports bindings without clone as CLONE_UNSUPPORTED", () => {
      const outcome = interpretHubCloneResult(
        cli(2, "", "error: unrecognized subcommand 'clone'\n\n  tip: a similar subcommand exists"),
      );
      assert.ok(isHubCloneFailure(outcome));
      assert.equal(outcome.code, "CLONE_UNSUPPORTED");
      assert.match(outcome.nextAction, /v0\.6\.0/);

      // Real 0.5.2 output under --json: the same text wrapped in Core's error envelope.
      const wrapped = interpretHubCloneResult(
        cli(
          2,
          "",
          `${JSON.stringify({
            error: {
              code: "GF_VALIDATION",
              message: "error: unrecognized subcommand 'clone'\n\n  tip: a similar subcommand exists: 'config'",
            },
          })}\n`,
        ),
      );
      assert.ok(isHubCloneFailure(wrapped));
      assert.equal(wrapped.code, "CLONE_UNSUPPORTED");
    });

    test("passes Core's structured error through, preferring the semantic code", () => {
      const stderr = `${JSON.stringify({
        error: {
          code: "GF_VALIDATION",
          message: "hub.missing_ref: ref main is not advertised",
          details: { source: "core", kind: "validation", semantic_code: "hub.missing_ref" },
        },
      })}\n`;
      const outcome = interpretHubCloneResult(cli(1, "", stderr));
      assert.ok(isHubCloneFailure(outcome));
      assert.equal(outcome.code, "hub.missing_ref");
      assert.equal(outcome.error, "hub.missing_ref: ref main is not advertised");
      assert.match(outcome.nextAction, /repository name/);
    });

    test("falls back to raw output for unstructured failures", () => {
      const outcome = interpretHubCloneResult(cli(1, "", "network unreachable"));
      assert.ok(isHubCloneFailure(outcome));
      assert.equal(outcome.code, "HUB_CLONE_FAILED");
      assert.match(outcome.error, /network unreachable/);
    });
  });

  test("cloneFromHub never calls Core for an invalid request", () => {
    let called = false;
    const outcome = cloneFromHub({ repository: "not a repo", destination: "/tmp/x" }, () => {
      called = true;
      return cli(0, receipt());
    });
    assert.ok(isHubCloneFailure(outcome));
    assert.equal(called, false);
  });

  test("cloneFromHub runs Core with the built argv", () => {
    let seen: string[] = [];
    const outcome = cloneFromHub({ repository: "openalex/openalex", destination: "/tmp/openalex" }, (args) => {
      seen = args;
      return cli(0, receipt());
    });
    assert.deepEqual(seen, ["clone", "openalex/openalex", "/tmp/openalex", "--json"]);
    assert.ok(!isHubCloneFailure(outcome));
  });
});
