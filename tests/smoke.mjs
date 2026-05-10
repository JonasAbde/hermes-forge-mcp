/**
 * Forge MCP — stdio smoke tests.
 *
 * Starts the compiled server as a subprocess and verifies that the MCP
 * contract is valid: resources/list, tools/list, prompts/list all return
 * expected schemas.
 *
 * Usage: node tests/smoke.mjs
 * Prerequisite: npm run build
 */

import { spawn } from "node:child_process";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, "..", "build", "index.js");

/**
 * Send a JSON-RPC request to the MCP server and return the parsed response.
 * Starts a fresh subprocess for each request (stdio transport).
 */
function sendRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [SERVER], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        FORGE_API_BASE_URL: process.env.FORGE_API_BASE_URL || "https://forge.tekup.dk/api/forge",
      },
    });

    const request = { jsonrpc: "2.0", id: 1, method, params };
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error(`Timeout after 10s. Stderr:\n${stderr}`));
    }, 10000);

    proc.on("close", (code) => {
      clearTimeout(timeout);
      try {
        // The MCP server may send multiple JSON-RPC responses over time.
        // Take the last complete JSON line.
        const lines = stdout.trim().split("\n").filter(Boolean);
        const last = lines[lines.length - 1];
        if (!last) {
          return reject(new Error(`No output. Exit code: ${code}\nStderr:\n${stderr}`));
        }
        resolve({ result: JSON.parse(last), stderr });
      } catch (e) {
        reject(new Error(`Parse error: ${e.message}\nStdout: ${stdout.slice(0, 500)}\nStderr: ${stderr.slice(0, 500)}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.stdin.end(JSON.stringify(request) + "\n");
  });
}

async function main() {
  let passed = 0;
  let failed = 0;

  function check(condition, message) {
    if (condition) {
      console.log(`  ✅ ${message}`);
      passed++;
    } else {
      console.error(`  ❌ ${message}`);
      failed++;
    }
  }

  // ── 1. resources/list ──────────────────────────────────────────
  console.log("\n📋 Testing resources/list...");
  const res = await sendRequest("resources/list");
  const resources = res.result?.result?.resources;
  check(Array.isArray(resources), "resources is an array");
  check(resources.length >= 3, "at least 3 resources");
  const resourceUris = resources.map((r) => r.uri);
  check(resourceUris.includes("forge://packs"), "forge://packs present");
  check(resourceUris.includes("forge://agents"), "forge://agents present");
  check(resourceUris.includes("forge://user/profile"), "forge://user/profile present");

  // Verify resource schema
  for (const r of resources) {
    check(typeof r.uri === "string", `resource ${r.uri} has string uri`);
    check(typeof r.name === "string", `resource ${r.uri} has string name`);
    check(typeof r.description === "string", `resource ${r.uri} has string description`);
    check(r.mimeType === "application/json", `resource ${r.uri} has mimeType`);
  }

  // ── 2. tools/list ──────────────────────────────────────────────
  console.log("\n🔧 Testing tools/list...");
  const toolRes = await sendRequest("tools/list");
  const tools = toolRes.result?.result?.tools;
  check(Array.isArray(tools), "tools is an array");
  check(tools.length === 9, "exactly 9 tools");

  const toolNames = tools.map((t) => t.name);
  const expectedTools = [
    "forge_list_packs", "forge_get_pack", "open_pack", "chat_with_agent", "fuse_agents",
    "get_xp", "subscribe_tier", "deploy_agent_to_telegram", "get_magic_link",
  ];
  for (const name of expectedTools) {
    check(toolNames.includes(name), `tool "${name}" present`);
  }

  // Verify tool schema
  for (const t of tools) {
    check(typeof t.name === "string", `tool ${t.name} has string name`);
    check(typeof t.description === "string", `tool ${t.name} has string description`);
    check(t.inputSchema?.type === "object", `tool ${t.name} has inputSchema`);
    if (t.inputSchema?.properties) {
      check(typeof t.inputSchema.properties === "object", `tool ${t.name} has properties`);
    }
  }

  // ── 3. prompts/list ────────────────────────────────────────────
  console.log("\n💬 Testing prompts/list...");
  const promptRes = await sendRequest("prompts/list");
  const prompts = promptRes.result?.result?.prompts;
  check(Array.isArray(prompts), "prompts is an array");
  check(prompts.length === 3, "exactly 3 prompts");

  const promptNames = prompts.map((p) => p.name);
  const expectedPrompts = ["agent_card", "pack_summary", "fusion_guide"];
  for (const name of expectedPrompts) {
    check(promptNames.includes(name), `prompt "${name}" present`);
  }

  // Verify prompt schema
  for (const p of prompts) {
    check(typeof p.name === "string", `prompt ${p.name} has string name`);
    check(typeof p.description === "string", `prompt ${p.name} has string description`);
    check(Array.isArray(p.arguments), `prompt ${p.name} has arguments array`);
  }

  // ── Summary ─────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Smoke test results: ${passed} passed, ${failed} failed`);
  console.log(`${"=".repeat(50)}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ Smoke test crashed:", err.message);
  process.exit(1);
});
