/**
 * Forge MCP — Resilience layer unit tests.
 *
 * Tests validation, retry, and health tracking in isolation.
 * Node.js native test runner. No HTTP calls — all mocked.
 *
 * Ported from: integrations/mcp-forge-registry/tests/test_api_resilience.py
 *
 * Usage: node --test tests/test-resilience.mjs
 */

import { describe, it, before, mock } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import the built resilience module
let resilience;
let index;

describe("Forge MCP — Response Validation (port from api_resilience.py)", () => {
  before(async () => {
    const buildPath = path.resolve(__dirname, "..", "build");
    resilience = await import(path.join(buildPath, "resilience.js"));
  });

  it("validatePackShape: valid pack returns isValid=true, no warnings", () => {
    const pack = {
      pack_id: "pack-1",
      slug: "pack-1",
      name: "Test Pack",
      status: "verified",
    };
    const result = resilience.validatePackShape(pack);
    assert.equal(result.isValid, true);
    assert.equal(result.warnings.length, 0);
  });

  it("validatePackShape: missing critical keys detected", () => {
    const pack = { pack_id: "pack-1" }; // missing: slug, name, status
    const result = resilience.validatePackShape(pack);
    assert.equal(result.isValid, false);
    assert.ok(result.warnings.some((w) => w.includes("Missing critical")));
  });

  it("validatePackShape: unexpected keys trigger warnings", () => {
    const pack = {
      pack_id: "pack-1",
      slug: "pack-1",
      name: "Test",
      status: "verified",
      weird_field: "unexpected",
    };
    const result = resilience.validatePackShape(pack);
    assert.equal(result.isValid, true); // critical keys present
    assert.ok(result.warnings.some((w) => w.includes("Unexpected keys")));
  });

  it("validatePackShape: non-object returns invalid", () => {
    assert.equal(resilience.validatePackShape(null).isValid, false);
    assert.equal(resilience.validatePackShape("string").isValid, false);
    assert.equal(resilience.validatePackShape([]).isValid, false);
  });

  it("validateDetailResponseShape: valid response passes", () => {
    const response = {
      status: "ok",
      pack: {
        pack_id: "pack-1",
        slug: "pack-1",
        name: "Test",
        status: "verified",
      },
      metrics: { runs: 100, trust_score: 85 },
    };
    const result = resilience.validateDetailResponseShape(response);
    assert.equal(result.isValid, true);
    assert.equal(result.warnings.length, 0);
  });

  it("validateDetailResponseShape: missing pack key rejected", () => {
    const response = { status: "ok" }; // no pack key
    const result = resilience.validateDetailResponseShape(response);
    assert.equal(result.isValid, false);
    assert.ok(result.warnings.some((w) => w.includes("pack key missing")));
  });

  it("validateDetailResponseShape: non-ok status warns but passes", () => {
    const response = {
      status: "error",
      pack: {
        pack_id: "pack-1",
        slug: "pack-1",
        name: "Test",
        status: "verified",
      },
    };
    const result = resilience.validateDetailResponseShape(response);
    assert.equal(result.isValid, true); // shape is valid
    assert.ok(result.warnings.some((w) => w.includes("Unexpected status")));
  });

  it("validateDetailResponseShape: non-object data rejected", () => {
    assert.equal(resilience.validateDetailResponseShape(null).isValid, false);
    assert.equal(resilience.validateDetailResponseShape("x").isValid, false);
  });

  it("validateAndLog: returns data on success", () => {
    const response = {
      status: "ok",
      pack: { pack_id: "x", slug: "x", name: "x", status: "ok" },
    };
    const result = resilience.validateAndLog(response, "test path");
    assert.equal(result.isValid, true);
    assert.ok(result.data !== null);
  });

  it("validateAndLog: returns null data on critical failure", () => {
    const result = resilience.validateAndLog({ status: "ok" }, "test");
    assert.equal(result.isValid, false);
    assert.equal(result.data, null);
  });
});

describe("Forge MCP — Exponential Backoff Retry (port from api_resilience.py)", () => {
  before(async () => {
    const buildPath = path.resolve(__dirname, "..", "build");
    resilience = await import(path.join(buildPath, "resilience.js"));
  });

  it("retries on transient failures and succeeds", { timeout: 5000 }, async () => {
    let callCount = 0;

    const result = await resilience.exponentialBackoffRetry(
      async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error("Transient error");
        }
        return "success";
      },
      { maxRetries: 3, baseDelayMs: 10 },
    );

    assert.equal(result, "success");
    assert.equal(callCount, 3); // failed twice, succeeded on third
  });

  it("gives up after max retries", { timeout: 5000 }, async () => {
    await assert.rejects(
      () =>
        resilience.exponentialBackoffRetry(
          async () => {
            throw new Error("Persistent error");
          },
          { maxRetries: 1, baseDelayMs: 10 },
        ),
      /Persistent error/,
    );
  });

  it("succeeds immediately with no retries needed", { timeout: 2000 }, async () => {
    const result = await resilience.exponentialBackoffRetry(
      async () => "immediate",
      { maxRetries: 3, baseDelayMs: 10 },
    );
    assert.equal(result, "immediate");
  });
});

describe("Forge MCP — Health Tracking (port from api_resilience.py)", () => {
  before(async () => {
    const buildPath = path.resolve(__dirname, "..", "build");
    resilience = await import(path.join(buildPath, "resilience.js"));
  });

  it("records and reports health stats", () => {
    resilience.recordHealth(true, 0);
    resilience.recordHealth(true, 0);
    resilience.recordHealth(false, 1);

    const stats = resilience.getHealthStats();
    assert.equal(stats.requests, 3);
    assert.equal(stats.errors, 1);
    assert.equal(stats.validationWarnings, 1);
    assert.equal(stats.errorRatePercent, 33.33);
  });
});
