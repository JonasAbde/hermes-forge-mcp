/**
 * Forge MCP — Model Context Protocol server for the Hermes Forge Platform.
 *
 * Exposes the Forge API (packs, chat, auth) to any MCP-compatible client:
 * Claude Desktop, Cursor, Windsurf, and others.
 *
 * Resources:
 *   forge://packs           — List all Agent Packs
 *   forge://user/profile    — Get authenticated user profile
 *
 * Tools:
 *   forge_list_packs        — List packs from the Forge catalog
 *   forge_get_pack          — Get details for a single pack
 *   forge_get_agent         — Get full agent details (XP, level, stats)
 *   forge_list_leaderboard  — List top packs by trust score
 *   chat_with_agent         — Chat in a Forge session
 *   get_magic_link          — Request a magic link for email auth
 *
 * Prompts:
 *   pack_summary            — Summarize an Agent Pack
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
import logger from "./logger.js";

// ─── MCP Server ──────────────────────────────────────────────────

const server = new Server(
  {
    name: "forge-mcp",
    version: "2.0.0",
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

// ─── START ──────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const config = getConfig();
  logger.info("Forge MCP running on stdio");
  logger.info(`API Base: ${config.baseUrl}`);
  logger.info(`Tools registered: ${toolSchemas.length}`);
  const authMethod = config.pat
    ? "PAT"
    : config.apiKey
      ? "API Key"
      : config.email
        ? "Email (magic link)"
        : "None";
  logger.info(`Auth: ${authMethod}`);
  if (hasAuth()) {
    logger.info(`Token: ${maskToken(config.pat || config.apiKey)}`);
  }
}

main().catch((err) => {
  logger.error("Fatal error", { error: String(err) });
  process.exit(1);
});
