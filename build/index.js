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
 *   chat_with_agent         — Chat in a Forge session
 *   get_magic_link          — Request a magic link for email auth
 *
 * Prompts:
 *   pack_summary            — Summarize an Agent Pack
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMCPToolSchemas, createResourceHandlers, createToolHandlers, createPromptHandlers, forgeFetch, requireAuth, getConfig, maskToken, hasAuth, } from "./shared.js";
// ─── MCP Server ──────────────────────────────────────────────────
const server = new Server({
    name: "forge-mcp",
    version: "1.0.0",
}, {
    capabilities: {
        resources: {},
        tools: {},
        prompts: {},
    },
});
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
    console.error("🚀 Forge MCP running on stdio");
    console.error(`   API Base: ${config.baseUrl}`);
    console.error(`   Tools registered: ${toolSchemas.length}`);
    const authMethod = config.pat
        ? "PAT"
        : config.apiKey
            ? "API Key"
            : config.email
                ? "Email (magic link)"
                : "None";
    console.error(`   Auth: ${authMethod}`);
    if (hasAuth()) {
        console.error(`   Token: ${maskToken(config.pat || config.apiKey)}`);
    }
}
main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map