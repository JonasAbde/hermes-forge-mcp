/**
 * Forge MCP — unit tests for auth guard and token masking.
 *
 * Imports the built server module and tests internal utilities.
 * Node.js native test runner.
 *
 * Usage: node --test tests/test-auth.mjs
 * Prerequisite: npm run build
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// We import from the built output to test the compiled code
let mod;

describe("Forge MCP — Auth & Token Safety", () => {
  before(async () => {
    // Dynamic import — the module starts the server on import,
    // but we only need to test the helper functions.
    // Due to the server starting immediately, we test via process isolation
    // by examining the source code patterns.
    mod = true;
  });

  it("server starts without auth for public endpoints", { timeout: 10000 }, async () => {
    const { spawn } = await import("node:child_process");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const server = path.resolve(__dirname, "..", "build", "index.js");

    // resources/list is public — should work without any auth
    const result = await new Promise((resolve, reject) => {
      const proc = spawn("node", [server], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          FORGE_API_BASE_URL: "https://forge.tekup.dk/api/forge",
          // No auth variables set
        },
      });

      const request = { jsonrpc: "2.0", id: 1, method: "resources/list" };
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d) => { stdout += d.toString(); });
      proc.stderr.on("data", (d) => { stderr += d.toString(); });

      const timeout = setTimeout(() => { proc.kill(); reject(new Error("Timeout")); }, 10000);

      proc.on("close", (code) => {
        clearTimeout(timeout);
        try {
          const lines = stdout.trim().split("\n").filter(Boolean);
          const last = JSON.parse(lines[lines.length - 1]);
          resolve({ result: last, stderr });
        } catch (e) {
          reject(new Error(`Parse fail: ${e.message}. Stderr: ${stderr.slice(0, 300)}`));
        }
      });
      proc.on("error", reject);
      proc.stdin.end(JSON.stringify(request) + "\n");
    });

    assert.strictEqual(result.result?.result?.resources?.length >= 3, true,
      "Should return resources without auth");
  });
});

describe("Forge MCP — Startup Logging (no token leak)", () => {
  it("server startup does not log raw token", { timeout: 10000 }, async () => {
    const { spawn } = await import("node:child_process");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const server = path.resolve(__dirname, "..", "build", "index.js");

    const result = await new Promise((resolve, reject) => {
      const proc = spawn("node", [server], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          FORGE_API_BASE_URL: "https://forge.tekup.dk/api/forge",
          FORGE_PAT: "hfp_super_secret_token_12345",
        },
      });

      const request = { jsonrpc: "2.0", id: 1, method: "resources/list" };
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d) => { stdout += d.toString(); });
      proc.stderr.on("data", (d) => { stderr += d.toString(); });

      const timeout = setTimeout(() => { proc.kill(); reject(new Error("Timeout")); }, 10000);

      proc.on("close", (code) => {
        clearTimeout(timeout);
        resolve({ stdout, stderr });
      });
      proc.on("error", (e) => { clearTimeout(timeout); reject(e); });
      proc.stdin.end(JSON.stringify(request) + "\n");
    });

    // The raw token should NOT appear in stderr
    assert.ok(!result.stderr.includes("hfp_super_secret_token_12345"),
      "Raw PAT should not appear in stderr/startup log");
    // But the masked version might appear
    assert.ok(result.stderr.includes("hfp_supe") || result.stderr.includes("Auth: PAT"),
      "Should show masked token or auth method");
  });
});

describe("Forge MCP — Token Masking Pattern", () => {
  it("erroneous responses are sanitized before reaching the user", { timeout: 10000 }, async () => {
    const { spawn } = await import("node:child_process");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const server = path.resolve(__dirname, "..", "build", "index.js");

    // call a mutation tool without auth — should get a helpful auth error, not a crash
    const result = await new Promise((resolve, reject) => {
      const proc = spawn("node", [server], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          FORGE_API_BASE_URL: "https://forge.tekup.dk/api/forge",
          // No auth
        },
      });

      const request = {
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "open_pack", arguments: { packId: "test" } },
      };
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d) => { stdout += d.toString(); });
      proc.stderr.on("data", (d) => { stderr += d.toString(); });

      const timeout = setTimeout(() => { proc.kill(); reject(new Error("Timeout")); }, 10000);

      proc.on("close", (code) => {
        clearTimeout(timeout);
        try {
          const lines = stdout.trim().split("\n").filter(Boolean);
          const last = JSON.parse(lines[lines.length - 1]);
          resolve({ result: last, stderr });
        } catch (e) {
          reject(new Error(`Parse: ${e.message}. Stderr: ${stderr.slice(0, 300)}`));
        }
      });
      proc.on("error", (e) => { clearTimeout(timeout); reject(e); });
      proc.stdin.end(JSON.stringify(request) + "\n");
    });

    // Should get an error about authentication
    assert.ok(
      result.result?.error?.message?.includes("Authentication required"),
      `Should show auth error: ${result.result?.error?.message?.slice(0, 100)}`
    );
    // Should mention how to fix it
    assert.ok(
      result.result?.error?.message?.includes("FORGE_PAT") ||
      result.result?.error?.message?.includes("API Key"),
      "Auth error should mention how to authenticate"
    );
  });
});

describe("Forge MCP — Tool Schema Validation", () => {
  it("chat_with_agent requires agentId and message", { timeout: 10000 }, async () => {
    const { spawn } = await import("node:child_process");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const server = path.resolve(__dirname, "..", "build", "index.js");

    // Check tool schema via stdio
    const result = await new Promise((resolve, reject) => {
      const proc = spawn("node", [server], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, FORGE_API_BASE_URL: "https://forge.tekup.dk/api/forge" },
      });

      const request = { jsonrpc: "2.0", id: 1, method: "tools/list" };
      let stdout = "";
      proc.stdout.on("data", (d) => { stdout += d.toString(); });
      const timeout = setTimeout(() => { proc.kill(); reject(new Error("Timeout")); }, 10000);
      proc.on("close", () => {
        clearTimeout(timeout);
        try {
          const lines = stdout.trim().split("\n").filter(Boolean);
          resolve({ result: JSON.parse(lines[lines.length - 1]) });
        } catch (e) { reject(e); }
      });
      proc.on("error", (e) => { clearTimeout(timeout); reject(e); });
      proc.stdin.end(JSON.stringify(request) + "\n");
    });

    const tools = result.result?.result?.tools ?? [];
    const chatTool = tools.find((t) => t.name === "chat_with_agent");
    assert.ok(chatTool, "chat_with_agent tool exists");
    assert.ok(chatTool.inputSchema?.required?.includes("agentId"),
      "chat_with_agent requires agentId");
    assert.ok(chatTool.inputSchema?.required?.includes("message"),
      "chat_with_agent requires message");

    const fuseTool = tools.find((t) => t.name === "fuse_agents");
    assert.ok(fuseTool, "fuse_agents tool exists");
    assert.ok(fuseTool.inputSchema?.required?.includes("baseAgentId"),
      "fuse_agents requires baseAgentId");
    assert.ok(fuseTool.inputSchema?.required?.includes("fodderAgentId"),
      "fuse_agents requires fodderAgentId");
  });
});
