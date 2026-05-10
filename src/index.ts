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
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as crypto from "node:crypto";
import {
  validateAndLog,
  exponentialBackoffRetry,
  recordHealth,
} from "./resilience.js";

// ─── Auth & Config ─────────────────────────────────────────────────────

interface ForgeConfig {
  baseUrl: string;
  pat?: string;
  apiKey?: string;
  email?: string;
}

function loadConfig(): ForgeConfig {
  const cfg: ForgeConfig = {
    baseUrl: process.env.FORGE_API_BASE_URL ?? "https://forge.tekup.dk/api/forge",
    pat: process.env.FORGE_PAT,
    apiKey: process.env.FORGE_API_KEY,
    email: process.env.FORGE_EMAIL,
  };
  return cfg;
}

const CONFIG = loadConfig();

// ─── Token Masking ───────────────────────────────────────────────────

/** Mask a sensitive token, showing only the first and last few characters. */
function maskToken(token: string | undefined, visibleChars = 8): string {
  if (!token || token.length <= visibleChars + 4) return "***";
  const head = token.slice(0, visibleChars);
  const tail = token.slice(-4);
  return `${head}...${tail}`;
}

/** Check whether the current config has authentication configured. */
function hasAuth(): boolean {
  return !!(CONFIG.pat || CONFIG.apiKey);
}

/** Build auth headers from config */
function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (CONFIG.pat) {
    h["Authorization"] = `Bearer ${CONFIG.pat}`;
  } else if (CONFIG.apiKey) {
    h["Authorization"] = `Bearer ${CONFIG.apiKey}`;
  }
  // Parse extra headers from env
  try {
    const extra = JSON.parse(process.env.FORGE_EXTRA_HEADERS ?? "{}");
    Object.assign(h, extra);
  } catch {
    // ignore
  }
  return h;
}

/** Error thrown when an authenticated endpoint is called without credentials. */
class AuthRequiredError extends Error {
  constructor(toolName: string) {
    super(
      `Authentication required for "${toolName}".\n\n` +
      `Set one of:\n` +
      `  - FORGE_PAT=hfp_xxx  (Personal Access Token from forge.tekup.dk/account)\n` +
      `  - FORGE_API_KEY=xxx  (API Key from forge.tekup.dk/account)\n\n` +
      `Pass these as environment variables in your MCP client config (see README).\n` +
      `Read-only endpoints (forge://packs, get_magic_link) work without auth.`
    );
  }
}

/** Require auth or throw a helpful error. */
function requireAuth(toolName: string): void {
  if (!hasAuth()) {
    throw new AuthRequiredError(toolName);
  }
}

/** Build a safe error message that never leaks raw tokens. */
function safeErrorMessage(context: string, raw: string): string {
  // Attempt to detect leaked tokens in error text
  const patPattern = /hfp_[A-Za-z0-9_-]{10,}/g;
  const keyPattern = /forge_key_[A-Za-z0-9_-]{10,}/g;
  const tgPattern = /\d{7,10}:[A-Za-z0-9_-]{35,}/g;

  let safe = raw;
  safe = safe.replace(patPattern, (m) => maskToken(m));
  safe = safe.replace(keyPattern, (m) => maskToken(m));
  safe = safe.replace(tgPattern, (m) => maskToken(m));
  return safe;
}

// ─── Forge API Client ────────────────────────────────────────────────

interface ForgeResponse<T = unknown> {
  status: string;
  [key: string]: unknown;
  data?: T;
}

/**
 * Fetch from the Forge API with automatic retry and response validation.
 * - Retries on transient failures (network, 5xx) with exponential backoff
 * - Validates response shape against expected contracts
 * - Records health metrics
 */
async function forgeFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
  validateResponse = false,
): Promise<ForgeResponse<T>> {
  const url = `${CONFIG.baseUrl}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...authHeaders(),
    ...(options.headers as Record<string, string> | undefined),
  };

  const fetchFn = async (): Promise<ForgeResponse<T>> => {
    const res = await fetch(url, { ...options, headers });

    if (!res.ok) {
      // For 5xx errors, retry with backoff
      if (res.status >= 500) {
        throw new Error(`Forge API ${res.status} error: ${res.statusText}`);
      }
      // For 4xx errors, throw immediately (auth issues, bad requests)
      const body = await res.text();
      let detail = body;
      try {
        const parsed = JSON.parse(body);
        detail = parsed.error ?? parsed.detail ?? body;
      } catch {
        // keep raw body
      }
      throw new Error(safeErrorMessage("forgeFetch", String(detail)));
    }

    const body = await res.json();

    // Validate response shape if requested (for known contracts)
    if (validateResponse) {
      const { isValid, warnings } = validateAndLog(body, path);
      recordHealth(isValid, warnings.length);
      if (!isValid) {
        throw new Error(safeErrorMessage("forgeFetch",
          `API response shape validation failed for ${path}. The API contract may have changed. ` +
          `Warnings: ${warnings.join("; ")}`
        ));
      }
    }

    if ((body as Record<string, unknown>).status === "error") {
      const detail = (body as Record<string, unknown>).error ??
        (body as Record<string, unknown>).detail ??
        "Forge API error";
      throw new Error(safeErrorMessage("forgeFetch", String(detail)));
    }

    return body as ForgeResponse<T>;
  };

  try {
    return await exponentialBackoffRetry(fetchFn, { maxRetries: 2, baseDelayMs: 100 });
  } catch (err) {
    recordHealth(false, 0);
    throw err;
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function textContent(text: string) {
  return { type: "text" as const, text };
}

function jsonContent(data: unknown) {
  return { type: "text" as const, text: JSON.stringify(data, null, 2) };
}

// ─── MCP Server ──────────────────────────────────────────────────

const server = new Server(
  {
    name: "forge-mcp",
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

// ─── RESOURCES ──────────────────────────────────────────────────

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "forge://packs",
        name: "Agent Packs Catalog",
        description: "List all Agent Packs available in the Forge catalog",
        mimeType: "application/json",
      },
      {
        uri: "forge://agents",
        name: "My Agents",
        description: "List the authenticated user's collected agents with XP, level, and stats",
        mimeType: "application/json",
      },
      {
        uri: "forge://user/profile",
        name: "User Profile",
        description: "Get the authenticated user's profile information",
        mimeType: "application/json",
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;

  switch (uri) {
    case "forge://packs": {
      const data = await forgeFetch("/packs");
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }

    case "forge://agents": {
      requireAuth("forge://agents");
      const data = await forgeFetch("/v1/agents");
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }

    case "forge://user/profile": {
      requireAuth("forge://user/profile");
      const data = await forgeFetch("/v1/me");
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown resource URI: ${uri}`);
  }
});

// ─── TOOLS ──────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "forge_list_packs",
        description:
          "List Agent Packs from the Forge catalog. Optionally filter by query, theme, or sort order.",
        inputSchema: {
          type: "object",
          properties: {
            catalog_only: {
              type: "boolean",
              description: "If true, only return catalog-eligible packs",
              default: true,
            },
            sort: {
              type: "string",
              description: "Sort order: trust-desc, trust-asc, or name-asc",
              default: "trust-desc",
            },
            query: {
              type: "string",
              description: "Optional substring search query",
            },
            theme: {
              type: "string",
              description: "Optional exact card theme filter",
            },
          },
        },
      },
      {
        name: "forge_get_pack",
        description:
          "Get full details for a single Agent Pack by ID. Use forge_list_packs to discover pack IDs.",
        inputSchema: {
          type: "object",
          properties: {
            pack_id: {
              type: "string",
              description: "The pack ID (e.g., 'hermes-agent')",
            },
          },
          required: ["pack_id"],
        },
      },
      {
        name: "open_pack",
        description:
          "Open/reveal a new agent from a pack. Creates an agent in your collection with random stat rolls. Requires authentication.",
        inputSchema: {
          type: "object",
          properties: {
            pack_id: {
              type: "string",
              description: "The pack ID to open (e.g., 'hermes-agent')",
            },
          },
          required: ["pack_id"],
        },
      },
      {
        name: "chat_with_agent",
        description:
          "Send a message in a Forge chat session. Creates a new session if none is provided. Requires authentication.",
        inputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "The message content to send",
            },
            session_id: {
              type: "string",
              description:
                "Optional: existing Forge session ID. If omitted, a new session is created.",
            },
            title: {
              type: "string",
              description:
                "Optional: session title (used when creating a new session)",
              default: "MCP Chat Session",
            },
          },
          required: ["message"],
        },
      },
      {
        name: "fuse_agents",
        description:
          "Fuse two agents together (Synthesis). 85% success — base gains levels. 15% Core Fracture — base resets to level 1. Fodder consumed. Requires authentication.",
        inputSchema: {
          type: "object",
          properties: {
            base_agent_id: {
              type: "string",
              description: "The base agent ID to keep and upgrade",
            },
            fodder_agent_id: {
              type: "string",
              description: "The fodder agent ID to consume (sacrificed)",
            },
          },
          required: ["base_agent_id", "fodder_agent_id"],
        },
      },
      {
        name: "get_xp",
        description:
          "Get the current XP, level, and level progress for a specific agent. Requires authentication.",
        inputSchema: {
          type: "object",
          properties: {
            agent_id: {
              type: "string",
              description: "The agent ID to query",
            },
          },
          required: ["agent_id"],
        },
      },
      {
        name: "subscribe_tier",
        description:
          "Get subscription tier and usage limits for the authenticated user. Requires authentication.",
        inputSchema: {
          type: "object",
          properties: {
            user_id: {
              type: "string",
              description: "Optional: user ID (defaults to authenticated user)",
            },
          },
        },
      },
      {
        name: "deploy_agent_to_telegram",
        description:
          "Deploy an agent to Telegram by creating a webhook. Requires authentication and a Telegram bot token from @BotFather.",
        inputSchema: {
          type: "object",
          properties: {
            agent_id: {
              type: "string",
              description: "The agent ID to deploy",
            },
            bot_token: {
              type: "string",
              description: "Telegram bot token from @BotFather",
            },
            secret: {
              type: "string",
              description: "Optional: webhook secret (auto-generated if omitted)",
            },
          },
          required: ["agent_id", "bot_token"],
        },
      },
      {
        name: "get_magic_link",
        description:
          "Request a magic link for email-based authentication. Does not require a PAT or API key.",
        inputSchema: {
          type: "object",
          properties: {
            email: {
              type: "string",
              description: "Email address to send the magic link to",
            },
            next: {
              type: "string",
              description:
                "Optional: post-login redirect path (default: '/')",
            },
          },
          required: ["email"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    // ── forge_list_packs ────────────────────────────────────────
    case "forge_list_packs": {
      const catalogOnly = args?.catalog_only !== false;
      const sort = String(args?.sort ?? "trust-desc");
      const query = String(args?.query ?? "").trim();
      const theme = String(args?.theme ?? "").trim();

      const params = new URLSearchParams();
      params.set("sort", sort);
      if (catalogOnly) params.set("catalog", "1");
      if (query) params.set("q", query);
      if (theme) params.set("theme", theme);

      const data = await forgeFetch(`/packs?${params.toString()}`);

      return {
        content: [
          jsonContent(data),
          textContent(
            `📦 Listed packs from Forge catalog. Use forge_get_pack for details on a specific pack.`,
          ),
        ],
      };
    }

    // ── forge_get_pack ──────────────────────────────────────────
    case "forge_get_pack": {
      const packId = String(args?.pack_id ?? "");
      if (!packId) throw new Error("pack_id is required");

      const data = await forgeFetch(`/packs/${encodeURIComponent(packId)}`);

      return {
        content: [
          jsonContent(data),
          textContent(
            `📦 Retrieved details for pack "${packId}".`,
          ),
        ],
      };
    }

    // ── open_pack ───────────────────────────────────────────────
    case "open_pack": {
      requireAuth("open_pack");
      const packId = String(args?.pack_id ?? "");
      if (!packId) throw new Error("pack_id is required");

      const data = await forgeFetch("/v1/agents", {
        method: "POST",
        body: JSON.stringify({ packId }),
      });

      return {
        content: [
          jsonContent(data),
          textContent(
            `✅ Agent opened from pack "${packId}"! Check forge://agents to see your new agent.`,
          ),
        ],
      };
    }

    // ── chat_with_agent ───────────────────────────────────────────
    case "chat_with_agent": {
      requireAuth("chat_with_agent");
      const message = String(args?.message ?? "");
      const sessionId = args?.session_id ? String(args.session_id) : undefined;
      const title = String(args?.title ?? "MCP Chat Session");

      if (!message) throw new Error("message is required");

      let sid = sessionId;

      // Create session if not provided
      if (!sid) {
        const sessionRes = await forgeFetch("/v1/chat/sessions", {
          method: "POST",
          body: JSON.stringify({
            title,
            metadata: { source: "mcp" },
          }),
        });
        sid = (sessionRes as Record<string, unknown>).id as string;
      }

      // Send message
      const msgRes = await forgeFetch(`/v1/chat/sessions/${sid}/messages`, {
        method: "POST",
        body: JSON.stringify({ role: "user", content: message }),
      });

      // Get messages
      const messagesData = await forgeFetch(`/v1/chat/sessions/${sid}/messages`);

      return {
        content: [
          jsonContent({
            session_id: sid,
            message: msgRes,
            messages: messagesData,
          }),
          textContent(
            `💬 Message sent (session: ${sid}).`,
          ),
        ],
      };
    }

    // ── fuse_agents ────────────────────────────────────────────
    case "fuse_agents": {
      requireAuth("fuse_agents");
      const baseAgentId = String(args?.base_agent_id ?? "");
      const fodderAgentId = String(args?.fodder_agent_id ?? "");

      if (!baseAgentId) throw new Error("base_agent_id is required");
      if (!fodderAgentId) throw new Error("fodder_agent_id is required");

      const data = await forgeFetch("/v1/synthesis/fuse", {
        method: "POST",
        body: JSON.stringify({ baseAgentId, fodderAgentId }),
      });

      const result = (data as Record<string, unknown>).result as string;
      const isSuccess = result === "success";
      const emoji = isSuccess ? "✨" : "💥";

      return {
        content: [
          jsonContent(data),
          textContent(
            `${emoji} Fusion ${result}! ${isSuccess ? "Base agent gained levels!" : "Core Fracture — base agent reset to level 1."}`,
          ),
        ],
      };
    }

    // ── get_xp ─────────────────────────────────────────────────
    case "get_xp": {
      requireAuth("get_xp");
      const agentIdXp = String(args?.agent_id ?? "");
      if (!agentIdXp) throw new Error("agent_id is required");

      const agent = await forgeFetch(`/v1/agents/${agentIdXp}`);

      return {
        content: [
          jsonContent(agent),
          textContent(
            `📊 XP details retrieved for ${agentIdXp}. See above for full stats.`,
          ),
        ],
      };
    }

    // ── subscribe_tier ──────────────────────────────────────────
    case "subscribe_tier": {
      requireAuth("subscribe_tier");
      const data = await forgeFetch("/v1/me/tier");

      return {
        content: [
          jsonContent(data),
          textContent(
            `📋 Subscription tier info retrieved. Check limits above.`,
          ),
        ],
      };
    }

    // ── deploy_agent_to_telegram ─────────────────────────────────
    case "deploy_agent_to_telegram": {
      requireAuth("deploy_agent_to_telegram");
      const depAgentId = String(args?.agent_id ?? "");
      const botToken = String(args?.bot_token ?? "");
      const providedSecret = args?.secret ? String(args.secret) : undefined;

      if (!depAgentId) throw new Error("agent_id is required");
      if (!botToken) throw new Error("bot_token is required");
      if (providedSecret && providedSecret.length < 16) {
        throw new Error("secret must be at least 16 characters long");
      }

      const webhookSecret = providedSecret ?? crypto.randomBytes(32).toString("hex");
      const targetUrl = `${CONFIG.baseUrl.replace("/api/forge", "")}/api/forge/v1/webhooks/telegram`;

      const webhookRes = await forgeFetch("/v1/webhooks", {
        method: "POST",
        body: JSON.stringify({
          url: targetUrl,
          events: ["agent.message", "agent.deployed"],
          secret: webhookSecret,
        }),
      });

      const webhookId = (webhookRes as Record<string, unknown>).id as string;

      return {
        content: [
          jsonContent(webhookRes),
          textContent(
            `🚀 Agent ${depAgentId} deployed to Telegram!\nWebhook ID: ${webhookId}\nSecret: ${webhookSecret.slice(0, 8)}...`,
          ),
        ],
      };
    }

    // ── get_magic_link ──────────────────────────────────────────
    case "get_magic_link": {
      const email = String(args?.email ?? "");
      const next = String(args?.next ?? "/");

      if (!email) throw new Error("email is required");

      const data = await forgeFetch("/v1/auth/magic", {
        method: "POST",
        body: JSON.stringify({ email, next }),
      });

      const devUrl = (data as Record<string, unknown>).dev_verify_url as
        | string
        | undefined;

      return {
        content: [
          jsonContent(data),
          textContent(
            `📧 Magic link sent to ${email}${devUrl ? `\n🔗 Dev verify URL: ${devUrl}` : ""}`,
          ),
        ],
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// ─── PROMPTS ──────────────────────────────────────────────────

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: "agent_card",
        description:
          "Generate a formatted agent card overview — stats, level, XP, rarity, and fusion history.",
        arguments: [
          {
            name: "agentId",
            description: "The ID of the agent to generate a card for",
            required: true,
          },
        ],
      },
      {
        name: "pack_summary",
        description:
          "Summarize an Agent Pack from the catalog — description, capabilities, rarity, and trust metrics.",
        arguments: [
          {
            name: "packId",
            description:
              "The pack ID (e.g., 'hermes-agent') to summarize",
            required: true,
          },
        ],
      },
      {
        name: "fusion_guide",
        description:
          "Generate a guide explaining agent fusion mechanics — success rates, stat bonuses, Core Fracture risk, and strategy tips.",
        arguments: [
          {
            name: "baseAgentId",
            description:
              "Optional: base agent ID to include specific stats in the guide",
            required: false,
          },
          {
            name: "fodderAgentId",
            description:
              "Optional: fodder agent ID to include specific fusion projections",
            required: false,
          },
        ],
      },
    ],
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "agent_card": {
      const agentId = String(args?.agentId ?? "");
      if (!agentId) throw new Error("agentId is required");

      const data = await forgeFetch(`/v1/agents/${agentId}`);
      const d = data as Record<string, unknown>;
      const agent = (d.agent ?? {}) as Record<string, unknown>;

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `## 🎴 Agent Card: ${String(agent.name ?? agentId)}

**ID:** ${agentId}
**Level:** ${String(agent.level ?? "N/A")}
**XP:** ${String(agent.xp ?? "N/A")}
**Rarity:** ${String(agent.rarity_label ?? "N/A")}
**Stats:** ${JSON.stringify(agent.stats ?? {}, null, 2)}

**Fusion History:**
${((agent.fusion_history ?? []) as string[]).join("\n") || "No fusions yet."}`,
            },
          },
        ],
      };
    }

    case "fusion_guide": {
      const baseAgentId = String(args?.baseAgentId ?? "");
      const fodderAgentId = String(args?.fodderAgentId ?? "");

      let extraContext = "";
      if (baseAgentId) {
        try {
          const data = await forgeFetch(`/v1/agents/${baseAgentId}`);
          const d = data as Record<string, unknown>;
          const agent = (d.agent ?? {}) as Record<string, unknown>;
          extraContext += `\n\n**Base Agent (${baseAgentId}):**\n- Level: ${String(agent.level ?? "N/A")}\n- XP: ${String(agent.xp ?? "N/A")}\n- Stats: ${JSON.stringify(agent.stats ?? {})}`;
        } catch { /* ignore */ }
      }

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `## ⚡ Agent Fusion Guide

Fusion combines two agents: a **base** (kept) and a **fodder** (consumed).

**Success Rate:** 85%
- Base agent gains XP and level
- Stat bonuses based on fodder rarity

**Core Fracture (15%):**
- Base agent resets to level 1
- All XP lost
- Fodder still consumed

**Strategy Tips:**
- Match complementary stat types
- Higher fodder rarity = bigger bonus
- Consider risk vs reward before fusing rare agents${extraContext}`,
            },
          },
        ],
      };
    }

    case "pack_summary": {
      const packId = String(args?.packId ?? "");
      if (!packId) throw new Error("packId is required");

      const data = await forgeFetch(`/packs/${packId}`);
      const d = data as Record<string, unknown>;
      const pack = (d.pack ?? {}) as Record<string, unknown>;
      const metrics = (d.metrics ?? {}) as Record<string, unknown>;
      const rating = (d.rating ?? {}) as Record<string, unknown>;

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `## 📦 Pack Summary: ${String(pack.name ?? packId)}

**ID:** ${packId}
**Status:** ${String(pack.status ?? "unknown")}
**Rarity:** ${String(pack.rarity_label ?? "N/A")}
**Trust Score:** ${String(pack.trust_score ?? "N/A")}
**Version:** ${String(pack.version ?? "N/A")}
**Theme:** ${String(pack.card_theme ?? "N/A")}

**Description:**
${String(pack.summary_md ?? pack.card_snippet ?? "No description available.")}

**Capabilities:**
${((pack.capabilities_json ?? []) as string[]).map((c: string) => `- ${c}`).join("\n") || "N/A"}

**Metrics:**
- Runs: ${String(metrics.runs ?? "N/A")}
- Success Rate: ${String(metrics.success_rate ?? "N/A")}%
- Avg Latency: ${String(metrics.avg_latency_ms ?? "N/A")}ms
- Install Count: ${String(d.install_count_live ?? "N/A")}

**Rating:** ⭐ ${String(rating.avg_rating ?? "N/A")} (${String(rating.total ?? 0)} reviews)

**Docs:** ${String(pack.docs_url ?? "N/A")}`,
            },
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
});

// ─── START ──────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🚀 Forge MCP running on stdio");
  console.error(`   API Base: ${CONFIG.baseUrl}`);
  const authMethod = CONFIG.pat ? "PAT" : CONFIG.apiKey ? "API Key" : CONFIG.email ? "Email (magic link)" : "None";
  console.error(`   Auth: ${authMethod}`);
  if (hasAuth()) {
    console.error(`   Token: ${maskToken(CONFIG.pat || CONFIG.apiKey)}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
