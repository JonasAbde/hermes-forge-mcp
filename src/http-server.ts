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
 *   forge_get_agent         — Get full agent details (XP, level, stats)
 *   forge_list_leaderboard  — List top packs by trust score
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
import rateLimit from "express-rate-limit";
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
import { packsCache, agentsCache, profileCache } from "./cache.js";
import { autoDiscovery } from "./discovery.js";
import logger from "./logger.js";

// ─── Config ─────────────────────────────────────────────────────

const PORT = parseInt(process.env.MCP_HTTP_PORT ?? "8641", 10);

// ─── MCP Server ──────────────────────────────────────────────────

const server = new Server(
  {
    name: "hermes-forge-mcp",
    version: "2.1.0",
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

// ─── Rate Limiting ────────────────────────────────────────────────

/** Rate limit: 100 requests per 15 minutes per IP. */
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — rate limit exceeded" },
});
app.use("/mcp", limiter);

// Health endpoints are NOT rate-limited so monitoring always works
app.use("/health", (_req, _res, next) => next());

// ─── Request Logging Middleware ───────────────────────────────────

app.use((req, _res, next) => {
  logger.info("HTTP request", {
    method: req.method,
    path: req.path,
    ip: req.ip,
  });
  next();
});

// ─── HTTP Transport ──────────────────────────────────────────────

/**
 * Single persistent StreamableHTTPServerTransport instance.
 * Connected to the MCP server once at startup — not per-request.
 * The transport handles session lifecycle internally using
 * sessionId from MCP protocol messages.
 */
let mcpTransport: StreamableHTTPServerTransport | null = null;

app.post("/mcp", async (req, res) => {
  if (!mcpTransport) {
    res.status(503).json({ error: "MCP transport not initialized" });
    return;
  }

  try {
    await mcpTransport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.error("MCP handler error", { error: String(err) });
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// ─── Health Endpoints ────────────────────────────────────────────

app.get("/health", (_req, res) => {
  const cfg = getConfig();
  const health = getHealthStats();
  res.json({
    status: "ok",
    server: "hermes-forge-mcp-http",
    version: "2.1.0",
    forgeApi: cfg.baseUrl,
    auth: hasAuth() ? "configured" : "not configured",
    health,
    cache: {
      packs: packsCache.stats(),
      agents: agentsCache.stats(),
      profile: profileCache.stats(),
    },
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

async function startServer() {
  const cfg = getConfig();

  // Create and connect the MCP transport once (not per-request)
  mcpTransport = new StreamableHTTPServerTransport();
  await server.connect(mcpTransport);

  const serverInstance = app.listen(PORT, "0.0.0.0", () => {
    logger.info(`Forge MCP (HTTP) running on port ${PORT}`);
    logger.info(`API Base: ${cfg.baseUrl}`);
    const authStatus = hasAuth() ? "configured" : "NOT configured — read-only only";
    logger.info(`Auth: ${authStatus}`);
    if (hasAuth()) {
      logger.info(`Token: ${maskToken(cfg.pat || cfg.apiKey)}`);
    }
    logger.info(`Health: http://0.0.0.0:${PORT}/health`);
    logger.info(`Tools:  http://0.0.0.0:${PORT}/health/tools`);

    // Run auto-discovery in background (don't block startup)
    autoDiscovery().then((result) => {
      if (result.uncoveredEndpoints.length > 0) {
        logger.info("Auto-discovery complete — uncovered endpoints", {
          count: result.uncoveredEndpoints.length,
          endpoints: result.uncoveredEndpoints,
        });
      } else {
        logger.info("Auto-discovery complete — all endpoints covered");
      }
      if (result.openApiSpecFound) {
        logger.info("OpenAPI spec found at Forge API");
      }
    }).catch((err) => {
      logger.warn("Auto-discovery failed", { error: String(err) });
    });
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    logger.info(`${signal} received — shutting down...`);
    serverInstance.close(() => {
      logger.info("HTTP server closed");
      process.exit(0);
    });
    // Force exit after 5s if graceful shutdown hangs
    setTimeout(() => {
      logger.error("Forced exit after timeout");
      process.exit(1);
    }, 5000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer();
