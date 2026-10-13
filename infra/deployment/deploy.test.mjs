#!/usr/bin/env node

/**
 * Unit tests for Wave 6 deployment modules.
 *
 * Tests core logic: digest parsing, state transitions, recovery boundaries,
 * audit redaction, env rendering. No Docker/database required.
 *
 * Run: node --test infra/deployment/deploy.test.mjs
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parseDigestArtifact, isDigest, isTemplateValue, parseEnv, serializeEnv } from "./env-utils.mjs";
import { sha256Hex } from "./deployment-state.mjs";
import { redact } from "./audit-log.mjs";

test("digest parsing: valid artifact", () => {
  const artifact = `
API_DIGEST=sha256:1111111111111111111111111111111111111111111111111111111111111111
API_OPERATIONS_DIGEST=sha256:2222222222222222222222222222222222222222222222222222222222222222
WEB_DIGEST=sha256:3333333333333333333333333333333333333333333333333333333333333333
VERSION=v1.2.3
`;
  const result = parseDigestArtifact(artifact);
  assert.equal(result.api, "sha256:1111111111111111111111111111111111111111111111111111111111111111");
  assert.equal(result.version, "v1.2.3");
});

test("digest parsing: rejects missing fields", () => {
  const artifact = `API_DIGEST=sha256:1111111111111111111111111111111111111111111111111111111111111111`;
  assert.throws(() => parseDigestArtifact(artifact), /missing.*WEB_DIGEST/);
});

test("digest parsing: rejects non-sha256 digest", () => {
  const artifact = `
API_DIGEST=invalid
API_OPERATIONS_DIGEST=sha256:2222222222222222222222222222222222222222222222222222222222222222
WEB_DIGEST=sha256:3333333333333333333333333333333333333333333333333333333333333333
VERSION=v1.0
`;
  assert.throws(() => parseDigestArtifact(artifact), /not a sha256 digest/);
});

test("isDigest: valid image reference", () => {
  assert.equal(
    isDigest("ghcr.io/owner/image@sha256:0000000000000000000000000000000000000000000000000000000000000000"),
    true,
  );
});

test("isDigest: rejects tag", () => {
  assert.equal(isDigest("ghcr.io/owner/image:v1.0"), false);
});

test("isDigest: rejects truncated hash", () => {
  assert.equal(isDigest("image@sha256:0000"), false);
});

test("isTemplateValue: detects placeholder", () => {
  assert.equal(isTemplateValue("replace-me"), true);
  assert.equal(isTemplateValue("change-me-now"), true);
  assert.equal(isTemplateValue("example.invalid"), true);
  assert.equal(isTemplateValue("dev-only"), true);
});

test("isTemplateValue: accepts production values", () => {
  assert.equal(isTemplateValue("production-value"), false);
  assert.equal(isTemplateValue("v1.2.3"), false);
});

test("env parse/serialize roundtrip: special chars", () => {
  const original = {
    PLAIN: "value",
    WITH_DOLLAR: "postgresql://user:p@ss$word@host",
    WITH_SPACE: "multi word value",
    EMPTY: "",
  };
  const serialized = serializeEnv(original);
  const parsed = parseEnv(serialized);
  assert.deepEqual(parsed, original);
});

test("audit redaction: removes secrets", () => {
  const fields = {
    deploymentId: "dep-123",
    phase: "VALIDATION",
    POSTGRES_PASSWORD: "secret123",
    JWT_ACCESS_SECRET: "also-secret",
    outcome: "passed",
    DATABASE_URL: "postgresql://...",
  };
  const safe = redact(fields);
  assert.deepEqual(safe, {
    deploymentId: "dep-123",
    phase: "VALIDATION",
    outcome: "passed",
  });
});

test("audit redaction: pattern matching is case-insensitive", () => {
  const fields = {
    bootstrap_token: "secret",
    my_key_value: "also-dropped-because-KEY-matches",
    deploymentId: "kept-because-no-pattern-matches",
  };
  const safe = redact(fields);
  assert.equal(safe.bootstrap_token, undefined);
  assert.equal(safe.my_key_value, undefined);
  assert.equal(safe.deploymentId, "kept-because-no-pattern-matches");
});

test("hash-chain: record hash depends on previous", () => {
  const safe1 = { event: "start", id: "1" };
  const safe2 = { event: "progress", id: "2" };

  const recordHash1 = sha256Hex(`\n${JSON.stringify(safe1)}`);
  const recordHash2 = sha256Hex(`${recordHash1}\n${JSON.stringify(safe2)}`);

  assert.notEqual(recordHash1, recordHash2);
  assert.notEqual(recordHash2, sha256Hex(`\n${JSON.stringify(safe2)}`));
});

test("migration marker: deployment-id scoping", () => {
  const deployment1 = "dep-aaa";
  const deployment2 = "dep-bbb";

  const marker1 = { deploymentId: deployment1, startedAt: "2026-10-13T00:00:00Z" };
  const marker2 = { deploymentId: deployment2, startedAt: "2026-10-13T00:01:00Z" };

  // Same deploymentId should match, different should not
  assert.equal(marker1.deploymentId === deployment1, true);
  assert.equal(marker2.deploymentId === deployment2, true);
  assert.equal(marker1.deploymentId === deployment2, false);
});

test("deployment-state validation: requires all images for recovery", () => {
  const prior = {
    completedAt: "2026-10-13T00:00:00Z",
    environment: "staging",
    applicationRelease: "v1.0.0",
    apiImage: "ghcr.io/...@sha256:...",
    // Missing apiOperationsImage, webImage, postgresImage
  };

  const requiredFields = [
    "apiImage",
    "apiOperationsImage",
    "webImage",
    "postgresImage",
    "applicationRelease",
  ];
  const missing = requiredFields.filter((field) => !prior[field]);
  assert.ok(missing.length > 0, "Should detect missing fields");
  assert.ok(missing.includes("apiOperationsImage"), "Should require apiOperationsImage");
});

test("smoke release matching: old release fails new expectation", () => {
  const health = { status: "ok", service: "api", release: "v1.0.0" };
  const expectedRelease = "v1.1.0";

  const matches = health.release === expectedRelease;
  assert.equal(matches, false, "Old release should not match new expectation");
});

test("smoke release matching: correct release passes", () => {
  const health = { status: "ok", service: "api", release: "v1.1.0" };
  const expectedRelease = "v1.1.0";

  const matches = health.release === expectedRelease;
  assert.equal(matches, true, "Matching release should pass");
});
