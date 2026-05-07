#!/usr/bin/env node
/**
 * Hermes Forge MCP Server — Example Usage Script
 *
 * This demonstrates programmatic use of the MCP server via stdio JSON-RPC.
 * Each example sends a JSON-RPC request and prints the response.
 *
 * Usage:
 *   node examples/usage.mjs
 *
 * Prerequisites:
 *   - Build the project: npm run build
 *   - Set FORGE_PAT (or other auth) in environment
 */

import { spawn } from "node:child_process";
import { strict as assert } from "node:assert";

const SERVER_PATH = new URL("../build/index.js", import.meta.url).pathname;

async function sendRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [SERVER_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        FORGE_PAT: process.env.FORGE_PAT || "",
        FORGE_API_KEY: process.env.FORGE_API_KEY || "",
        FORGE_API_BASE_URL: process.env.FORGE_API_BASE_URL || "https://forge.tekup.dk/api/forge",
      },
    });

    const request = {
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    };

    let output = "";
    proc.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      // stderr is for logging — ignore or print
      // console.error(chunk.toString().trim());
    });

    proc.on("close", (code) => {
      try {
        const lines = output.trim().split("\n");
        const last = lines[lines.length - 1];
        resolve(JSON.parse(last));
      } catch (e) {
        reject(new Error(`Parse error: ${e.message}\nOutput: ${output}`));
      }
    });

    proc.on("error", reject);
    proc.stdin.end(JSON.stringify(request) + "\n");
  });
}

async function main() {
  console.log("=".repeat(60));
  console.log("Hermes Forge MCP Server — Example Usage");
  console.log("=".repeat(60));

  // 1. List Resources
  console.log("\n📋 Listing resources...");
  try {
    const resources = await sendRequest("resources/list");
    console.log(JSON.stringify(resources, null, 2));
    assert(resources.result?.resources?.length >= 3, "Expected at least 3 resources");
    console.log("✅ resources/list works!");
  } catch (e) {
    console.error("❌ resources/list failed:", e.message);
  }

  // 2. List Tools
  console.log("\n🔧 Listing tools...");
  try {
    const tools = await sendRequest("tools/list");
    console.log(`Found ${tools.result?.tools?.length ?? 0} tools`);
    const toolNames = (tools.result?.tools ?? []).map((t) => t.name);
    console.log("  Tools:", toolNames.join(", "));
    assert(toolNames.includes("open_pack"), "Expected open_pack tool");
    assert(toolNames.includes("chat_with_agent"), "Expected chat_with_agent tool");
    assert(toolNames.includes("fuse_agents"), "Expected fuse_agents tool");
    assert(toolNames.includes("get_xp"), "Expected get_xp tool");
    assert(toolNames.includes("subscribe_tier"), "Expected subscribe_tier tool");
    assert(toolNames.includes("deploy_agent_to_telegram"), "Expected deploy_agent_to_telegram tool");
    console.log("✅ tools/list works!");
  } catch (e) {
    console.error("❌ tools/list failed:", e.message);
  }

  // 3. List Prompts
  console.log("\n💬 Listing prompts...");
  try {
    const prompts = await sendRequest("prompts/list");
    console.log(`Found ${prompts.result?.prompts?.length ?? 0} prompts`);
    const promptNames = (prompts.result?.prompts ?? []).map((p) => p.name);
    console.log("  Prompts:", promptNames.join(", "));
    assert(promptNames.includes("agent_card"), "Expected agent_card prompt");
    assert(promptNames.includes("pack_summary"), "Expected pack_summary prompt");
    assert(promptNames.includes("fusion_guide"), "Expected fusion_guide prompt");
    console.log("✅ prompts/list works!");
  } catch (e) {
    console.error("❌ prompts/list failed:", e.message);
  }

  // 4. Read forge://packs resource (public — no auth needed)
  console.log("\n📦 Reading forge://packs resource...");
  try {
    const packs = await sendRequest("resources/read", {
      uri: "forge://packs",
    });
    const data = JSON.parse(packs.result?.contents?.[0]?.text ?? "{}");
    const count = Array.isArray(data.packs) ? data.packs.length : data.total ?? "?";
    console.log(`Found ${count} packs in catalog`);
    console.log("✅ forge://packs works!");
  } catch (e) {
    console.log("  ℹ️  Note: packs endpoint may return error if API is unavailable");
    console.log("  ", e.message.slice(0, 100));
  }

  // 5. Test get_magic_link (public)
  console.log("\n📧 Testing get_magic_link tool...");
  try {
    const result = await sendRequest("tools/call", {
      name: "get_magic_link",
      arguments: { email: "test@example.com" },
    });
    console.log("✅ get_magic_link works!");
    const text = result.result?.content?.[1]?.text ?? "";
    console.log("  Response:", text.slice(0, 120));
  } catch (e) {
    console.log("  ℹ️  Note: magic link may be rate-limited");
    console.log("  ", e.message.slice(0, 100));
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("✅ Example tests complete!");
  console.log("");
  console.log("All features available:");
  console.log("  📦 Resources: forge://packs, forge://agents, forge://user/profile");
  console.log("  🔧 Tools: open_pack, chat_with_agent, fuse_agents, get_xp,");
  console.log("           subscribe_tier, deploy_agent_to_telegram, get_magic_link");
  console.log("  💬 Prompts: agent_card, pack_summary, fusion_guide");
}

main().catch(console.error);
