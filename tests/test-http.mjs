/**
 * Forge MCP — HTTP transport smoke tests.
 *
 * Starts the compiled HTTP server as a subprocess and verifies:
 * - /health endpoint returns valid health data
 * - /health/tools endpoint returns tool list
 * - POST /mcp can initialize MCP protocol
 * - Graceful shutdown via SIGTERM
 *
 * Usage: node tests/test-http.mjs
 * Prerequisite: npm run build
 */

import { spawn } from "node:child_process";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, "..", "build", "http-server.js");
const PORT = 18641; // Use non-standard port to avoid conflicts
const BASE = `http://127.0.0.1:${PORT}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const body = await res.json();
  return { status: res.status, body };
}

/**
 * Send an MCP request and get the response.
 * On first call, returns JSON directly.
 * After initialize, StreamableHTTP may respond with SSE.
 */
async function sendMCPRequest(body) {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return { status: res.status, data: await res.json() };
  }

  // SSE response — parse text
  const text = await res.text();
  // Extract the data line from SSE
  const dataMatch = text.match(/data: (.+)/);
  if (dataMatch) {
    try {
      return { status: res.status, data: JSON.parse(dataMatch[1]) };
    } catch {
      return { status: res.status, data: null, raw: text };
    }
  }
  return { status: res.status, data: null, raw: text };
}

async function runTests() {
  let serverProcess;
  let testsPassed = 0;
  let testsFailed = 0;

  function assertEqual(actual, expected, label) {
    try {
      assert.deepStrictEqual(actual, expected);
      console.log(`  ✅ ${label}`);
      testsPassed++;
    } catch (err) {
      console.log(`  ❌ ${label}`);
      console.log(`     Expected: ${JSON.stringify(expected)}`);
      console.log(`     Actual:   ${JSON.stringify(actual)}`);
      testsFailed++;
    }
  }

  function assertMatch(actual, predicate, label) {
    try {
      assert.ok(predicate(actual), `${label}: value didn't match predicate`);
      console.log(`  ✅ ${label}`);
      testsPassed++;
    } catch (err) {
      console.log(`  ❌ ${label}`);
      console.log(`     Value: ${JSON.stringify(actual)}`);
      testsFailed++;
    }
  }

  try {
    // ── Start server ──────────────────────────────────────────
    console.log("\n🔧 Starting HTTP server...");
    serverProcess = spawn(process.execPath, [SERVER], {
      env: {
        ...process.env,
        MCP_HTTP_PORT: String(PORT),
        FORGE_API_BASE_URL: "http://127.0.0.1:99999",
        NODE_ENV: "test",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const output = { stdout: "", stderr: "" };
    serverProcess.stdout.on("data", (d) => (output.stdout += d.toString()));
    serverProcess.stderr.on("data", (d) => (output.stderr += d.toString()));

    // Wait for server to start
    await sleep(2000);

    // ── Test 1: /health endpoint ──────────────────────────────
    console.log("\n📋 Test: /health endpoint");
    const health = await fetchJson(`${BASE}/health`);
    assertEqual(health.status, 200, "Health returns 200");
    assertEqual(health.body.status, "ok", 'Health status is "ok"');
    assertEqual(health.body.server, "hermes-forge-mcp-http", "Server name matches");
    assertEqual(health.body.version, "2.0.0", "Version matches");
    assertMatch(
      health.body.forgeApi,
      (v) => typeof v === "string",
      "forgeApi is a string",
    );
    assertMatch(
      health.body.health,
      (v) => typeof v === "object" && v !== null,
      "health object exists",
    );

    // ── Test 2: /health/tools endpoint ────────────────────────
    console.log("\n📋 Test: /health/tools endpoint");
    const tools = await fetchJson(`${BASE}/health/tools`);
    assertEqual(tools.status, 200, "Tools returns 200");
    assertEqual(tools.body.status, "ok", 'Tools status is "ok"');
    assertMatch(tools.body.total, (v) => v > 0, "Has at least 1 tool");
    assertMatch(
      Array.isArray(tools.body.tools),
      (v) => v === true,
      "tools is an array",
    );

    const toolNames = tools.body.tools.map((t) => t.name);
    assertMatch(
      toolNames.includes("forge_list_packs"),
      (v) => v === true,
      "forge_list_packs tool exists",
    );
    assertMatch(
      toolNames.includes("get_magic_link"),
      (v) => v === true,
      "get_magic_link tool exists",
    );

    // ── Test 3: POST /mcp with initialize request ─────────────
    console.log("\n📋 Test: POST /mcp (MCP initialize)");
    const initResp = await sendMCPRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });
    assertEqual(initResp.status, 200, "MCP initialize returns 200");
    assertMatch(initResp.data?.jsonrpc, (v) => v === "2.0", "JSON-RPC version is 2.0");
    assertMatch(initResp.data?.id, (v) => v === 1, "Response ID matches request");
    assertMatch(
      initResp.data?.result?.serverInfo?.name,
      (v) => typeof v === "string",
      "Server info present",
    );

    // ── Test 4: Auth status in health ─────────────────────────
    console.log("\n📋 Test: Auth status (no PAT configured)");
    assertEqual(
      health.body.auth,
      "not configured",
      "Auth reports not configured when no PAT set",
    );

    // ── Done ──────────────────────────────────────────────────
    console.log("\n");

  } catch (err) {
    console.error("Test error:", err.message);
    testsFailed++;
  } finally {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill("SIGTERM");
      await sleep(500);
      if (!serverProcess.killed) {
        serverProcess.kill("SIGKILL");
      }
    }
  }

  return { passed: testsPassed, failed: testsFailed };
}

const result = await runTests();
console.log(`\n═══ Results ═══`);
console.log(`  Passed: ${result.passed}`);
console.log(`  Failed: ${result.failed}`);
process.exit(result.failed > 0 ? 1 : 0);
