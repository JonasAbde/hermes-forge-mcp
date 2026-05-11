/**
 * Hermes Forge MCP Server — HTTP Transport Wrapper
 *
 * Exposes the Forge MCP server over HTTP using the MCP SDK's
 * StreamableHTTPServerTransport, making it accessible as a network service.
 * Also provides health check endpoints for monitoring.
 *
 * Resources:
 *   forge://packs           — List all Agent Packs
 *   forge://agents          — List user's collected agents
 *   forge://user/profile    — Get authenticated user profile
 *
 * Tools:
 *   forge_list_packs        — List packs from the Forge catalog
 *   forge_get_pack          — Get details for a single pack
 *   open_pack               — Open/reveal a new agent from a pack
 *   chat_with_agent         — Chat with an agent in a session
 *   fuse_agents             — Fuse two agents (synthesis)
 *   get_xp                  — Get XP/level info for an agent
 *   subscribe_tier          — Get subscription tier info
 *   deploy_agent_to_telegram — Deploy an agent to Telegram webhook
 *   get_magic_link          — Request a magic link for email auth
 *
 * Prompts:
 *   agent_card              — Generate an agent card overview
 *   pack_summary            — Summarize an Agent Pack
 *   fusion_guide            — Guide to agent fusion mechanics
 */

import express from "express";
import cors from "cors";
import * as crypto from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  createMCPToolSchemas,
  createResourceHandlers,
  createToolHandlers,
  createPromptHandlers,
  forgeFetch,
  requireAuth,
  getConfig,
  maskToken,
  hasAuth,
} from "./shared.js";
import { getHealthStats } from "./resilience.js";

// ─── Config ─────────────────────────────────────────────────────

const PORT = parseInt(process.env.MCP_HTTP_PORT ?? "8641", 10);

// ─── MCP Server ──────────────────────────────────────────────────

const server = new Server(
  {
    name: "hermes-forge-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
      prompts: {},
    },
  },
);

// ─── Handler Wiring ──────────────────────────────────────────────────

const toolSchemas = createMCPToolSchemas(server);
createResourceHandlers(server, forgeFetch, requireAuth);
createToolHandlers(server, forgeFetch, requireAuth);
createPromptHandlers(server, forgeFetch, requireAuth);

// ─── Express App ─────────────────────────────────────────────────

const app = express();

// CORS — allow any origin for MCP clients (Claude Desktop, Cursor, etc.)
app.use(cors());
app.use(express.json());

// ─── HTTP Transport ──────────────────────────────────────────────

const transports = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", async (req, res) => {
  const sessionId = crypto.randomUUID();
  const transport = new StreamableHTTPServerTransport();
  transports.set(sessionId, transport);

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[Forge MCP] MCP handler error:", err);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    transports.delete(sessionId);
  }
});

// ─── Health Endpoints ────────────────────────────────────────────

app.get("/health", (_req, res) => {
  const cfg = getConfig();
  const health = getHealthStats();
  res.json({
    status: "ok",
    server: "hermes-forge-mcp-http",
    version: "1.0.0",
    forgeApi: cfg.baseUrl,
    auth: hasAuth() ? "configured" : "not configured",
    health,
  });
});

app.get("/health/tools", (_req, res) => {
  const tools = toolSchemas.map((t) => ({
    name: t.name,
    description: t.description,
  }));
  res.json({
    status: "ok",
    total: tools.length,
    tools,
  });
});

// ─── Start ───────────────────────────────────────────────────────

function startServer() {
  const cfg = getConfig();

  const serverInstance = app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Forge MCP (HTTP) running on port ${PORT}`);
    console.log(`   API Base: ${cfg.baseUrl}`);
    console.log(`   Auth: ${hasAuth() ? "configured" : "NOT configured — read-only only"}`);
    if (hasAuth()) {
      console.log(`   Token: ${maskToken(cfg.pat || cfg.apiKey)}`);
    }
    console.log(`   Health: http://0.0.0.0:${PORT}/health`);
    console.log(`   Tools:  http://0.0.0.0:${PORT}/health/tools`);
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    console.log(`\n[Forge MCP] ${signal} received — shutting down...`);
    serverInstance.close(() => {
      console.log("[Forge MCP] HTTP server closed");
      process.exit(0);
    });
    // Force exit after 5s if graceful shutdown hangs
    setTimeout(() => {
      console.error("[Forge MCP] Forced exit after timeout");
      process.exit(1);
    }, 5000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer();
