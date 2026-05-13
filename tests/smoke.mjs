/**
 * Forge MCP — stdio smoke tests.
 *
 * Starts the compiled server as a subprocess and verifies that the MCP
 * contract is valid: resources/list, tools/list, prompts/list all return
 * expected schemas with strict type and content assertions.
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

// ── Helpers ────────────────────────────────────────────────────────

const VALID_JSON_SCHEMA_TYPES = new Set([
  "string", "boolean", "integer", "number", "array", "object",
]);

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
        FORGE_API_BASE_URL:
          process.env.FORGE_API_BASE_URL || "https://forge.tekup.dk/api/forge",
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
          return reject(
            new Error(`No output. Exit code: ${code}\nStderr:\n${stderr}`)
          );
        }
        resolve({ result: JSON.parse(last), stderr });
      } catch (e) {
        reject(
          new Error(
            `Parse error: ${e.message}\nStdout: ${stdout.slice(
              0,
              500
            )}\nStderr: ${stderr.slice(0, 500)}`
          )
        );
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
  // ── Resource Validation ─────────────────────────────────────────
  const resourceUris = resources.map((r) => r.uri);
  const resourceNames = resources.map((r) => r.name);

  const expectedResourceUris = [
    "forge://packs",
    "forge://agents",
    "forge://user/profile",
    "forge://agents/{agentId}/evolution",
    "forge://agents/{agentId}/lineage",
  ];
  const expectedResourceNames = [
    "Agent Packs Catalog",
    "My Agents",
    "User Profile",
    "Agent Evolution State",
    "Agent Lineage / Genealogy",
  ];

  check(resources.length === 5, "exactly 5 resources");
  check(
    JSON.stringify([...resourceUris].sort()) ===
      JSON.stringify([...expectedResourceUris].sort()),
    "all 5 resource URIs exactly match expected set"
  );
  check(
    JSON.stringify([...resourceNames].sort()) ===
      JSON.stringify([...expectedResourceNames].sort()),
    "all 5 resource names exactly match expected set"
  );

  // Verify each URI uses the forge:// scheme
  for (const uri of resourceUris) {
    check(uri.startsWith("forge://"), `resource URI "${uri}" starts with forge://`);
  }

  // Individual URI presence (backward compat)
  check(resourceUris.includes("forge://packs"), 'forge://packs present');
  check(resourceUris.includes("forge://agents"), 'forge://agents present');
  check(resourceUris.includes("forge://user/profile"), 'forge://user/profile present');

  // Verify resource schema in detail
  for (const r of resources) {
    check(typeof r.uri === "string", `resource ${r.uri} has string uri`);
    check(typeof r.name === "string", `resource ${r.uri} has string name`);
    check(
      typeof r.description === "string",
      `resource ${r.uri} has string description`
    );
    check(
      r.description.length > 0,
      `resource ${r.uri} has non-empty description`
    );
    check(
      r.mimeType === "application/json",
      `resource ${r.uri} has mimeType application/json`
    );
  }

  // ── 2. tools/list ──────────────────────────────────────────────
  console.log("\n🔧 Testing tools/list...");
  const toolRes = await sendRequest("tools/list");
  const tools = toolRes.result?.result?.tools;
  check(Array.isArray(tools), "tools is an array");
  check(tools.length === 22, "exactly 22 tools");

  const toolNames = tools.map((t) => t.name);
  const expectedTools = [
    "forge_list_packs",
    "forge_get_pack",
    "open_pack",
    "chat_with_agent",
    "fuse_agents",
    "forge_get_agent",
    "forge_list_leaderboard",
    "subscribe_tier",
    "deploy_agent_to_telegram",
    "get_magic_link",
    "forge_agent_traits",
    "forge_agent_lineage",
    "forge_get_profile",
    "forge_list_agents",
    "forge_list_deployments",
    "forge_list_activities",
    "forge_list_agent_runs",
    "forge_search_packs",
    "forge_list_missions",
    "forge_start_mission",
    "forge_complete_mission",
    "forge_claim_mission_reward",
  ];

  // Exact set match for tool names
  check(
    JSON.stringify([...toolNames].sort()) ===
      JSON.stringify([...expectedTools].sort()),
    "all 18 tool names exactly match expected set"
  );

  // Individual presence checks (backward compat)
  for (const name of expectedTools) {
    check(toolNames.includes(name), `tool "${name}" present`);
  }

  // Verify tool schema in detail
  for (const t of tools) {
    check(typeof t.name === "string", `tool ${t.name} has string name`);
    check(
      typeof t.description === "string",
      `tool ${t.name} has string description`
    );
    check(
      t.description.length > 0,
      `tool ${t.name} has non-empty description`
    );
    check(
      t.inputSchema?.type === "object",
      `tool ${t.name} has inputSchema with type "object"`
    );

    // Verify each property has valid JSON Schema type and description
    const props = t.inputSchema?.properties;
    check(
      props !== undefined && typeof props === "object",
      `tool ${t.name} has inputSchema.properties as object`
    );

    if (props && typeof props === "object") {
      for (const [propName, propSchema] of Object.entries(props)) {
        check(
          typeof propSchema === "object" && propSchema !== null,
          `tool ${t.name}.${propName} has a schema object`
        );
        check(
          typeof propSchema.type === "string" &&
            VALID_JSON_SCHEMA_TYPES.has(propSchema.type),
          `tool ${t.name}.${propName} has valid type "${propSchema.type}"`
        );
        check(
          typeof propSchema.description === "string",
          `tool ${t.name}.${propName} has string description`
        );
        check(
          propSchema.description.length > 0,
          `tool ${t.name}.${propName} has non-empty description`
        );
      }
    }
  }

  // ── 3. prompts/list ────────────────────────────────────────────
  console.log("\n💬 Testing prompts/list...");
  const promptRes = await sendRequest("prompts/list");
  const prompts = promptRes.result?.result?.prompts;
  check(Array.isArray(prompts), "prompts is an array");
  check(prompts.length === 4, "exactly 4 prompts");

  const promptNames = prompts.map((p) => p.name);
  const expectedPrompts = [
    "agent_card",
    "pack_summary",
    "fusion_guide",
    "evolution_report",
  ];

  // Exact set match
  check(
    JSON.stringify([...promptNames].sort()) ===
      JSON.stringify([...expectedPrompts].sort()),
    "all 4 prompt names exactly match expected set"
  );

  // Individual presence checks (backward compat)
  for (const name of expectedPrompts) {
    check(promptNames.includes(name), `prompt "${name}" present`);
  }

  // Verify prompt schema in detail
  for (const p of prompts) {
    check(typeof p.name === "string", `prompt ${p.name} has string name`);
    check(
      typeof p.description === "string",
      `prompt ${p.name} has string description`
    );
    check(
      p.description.length > 0,
      `prompt ${p.name} has non-empty description`
    );
    check(
      Array.isArray(p.arguments),
      `prompt ${p.name} has arguments array`
    );

    // Verify each argument has valid schema
    if (Array.isArray(p.arguments)) {
      for (const arg of p.arguments) {
        check(
          typeof arg === "object" && arg !== null && !Array.isArray(arg),
          `prompt ${p.name} argument is an object`
        );
        check(
          typeof arg.name === "string" && arg.name.length > 0,
          `prompt ${p.name} argument "${arg.name}" has valid name`
        );
        check(
          typeof arg.description === "string" && arg.description.length > 0,
          `prompt ${p.name} argument "${arg.name}" has valid description`
        );
        check(
          typeof arg.required === "boolean",
          `prompt ${p.name} argument "${arg.name}" has boolean required`
        );
      }
    }
  }

  // ── Summary ─────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${"=".repeat(50)}`);
  console.log(
    `Smoke test results: ${passed} passed, ${failed} failed (${total} total assertions)`
  );
  console.log(`${"=".repeat(50)}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ Smoke test crashed:", err.message);
  process.exit(1);
});
