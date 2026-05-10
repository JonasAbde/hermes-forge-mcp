/**
 * Hermes Forge MCP Server — HTTP Transport Wrapper
 *
 * Exposes the stdio-based MCP server over HTTP using the MCP SDK's
 * StreamableHTTPServerTransport, making it accessible as a network service.
 * Also provides a health check endpoint for monitoring.
 *
 * Resources:
 *   forge://packs           — List all Agent Packs
 *   forge://agents          — List user's collected agents
 *   forge://user/profile    — Get authenticated user profile
 *
 * Tools:
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
import * as crypto from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ─── Auth & Config ─────────────────────────────────────────────────────

interface ForgeConfig {
  baseUrl: string;
  pat?: string;
  apiKey?: string;
  email?: string;
}

function loadConfig(): ForgeConfig {
  return {
    baseUrl: process.env.FORGE_API_BASE_URL ?? "https://forge.tekup.dk/api/forge",
    pat: process.env.FORGE_PAT,
    apiKey: process.env.FORGE_API_KEY,
    email: process.env.FORGE_EMAIL,
  };
}

const PORT = parseInt(process.env.MCP_HTTP_PORT ?? "8642", 10);
const CONFIG = loadConfig();

// ─── Token Masking & Auth Helpers ─────────────────────────────────────

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
      `Read-only endpoints (forge://packs, get_magic_link) work without auth.`,
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

async function forgeFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<ForgeResponse<T>> {
  const url = `${CONFIG.baseUrl}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...authHeaders(),
    ...(options.headers as Record<string, string> | undefined),
  };

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const body = await res.json();
  if ((body as Record<string, unknown>).status === "error") {
    const detail =
      (body as Record<string, unknown>).error ??
      (body as Record<string, unknown>).detail ??
      "Forge API error";
    throw new Error(safeErrorMessage("forgeFetch", String(detail)));
  }
  return body as ForgeResponse<T>;
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

// ─── RESOURCES ──────────────────────────────────────────────────

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "forge://packs",
        name: "Agent Packs Catalog",
        description: "List all Agent Packs available in the Hermes Forge catalog",
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
        name: "open_pack",
        description:
          "Open/reveal a new agent from a pack. Creates an agent in your collection with random stat rolls. Requires authentication.",
        inputSchema: {
          type: "object",
          properties: {
            packId: {
              type: "string",
              description:
                "The pack ID to open (e.g., 'hermes-agent', 'code-assistant'). Discover available packs via the forge://packs resource.",
            },
          },
          required: ["packId"],
        },
      },
      {
        name: "chat_with_agent",
        description:
          "Send a message to an agent in a chat session. Auto-rewards 25 XP. Requires authentication.",
        inputSchema: {
          type: "object",
          properties: {
            agentId: {
              type: "string",
              description: "The ID of the agent to chat with",
            },
            message: {
              type: "string",
              description: "The message content to send",
            },
            sessionId: {
              type: "string",
              description:
                "Optional: existing session ID to continue a conversation. If omitted, a new session is created.",
            },
            model: {
              type: "string",
              description:
                "Optional: the model to use (defaults to the agent's pack model)",
            },
          },
          required: ["agentId", "message"],
        },
      },
      {
        name: "fuse_agents",
        description:
          "Fuse two agents together (Synthesis). 85% success — base gains levels. 15% Core Fracture — base resets to level 1. Fodder consumed. Requires authentication.",
        inputSchema: {
          type: "object",
          properties: {
            baseAgentId: {
              type: "string",
              description: "The ID of the base agent (survives on success)",
            },
            fodderAgentId: {
              type: "string",
              description: "The ID of the fodder/sacrifice agent (consumed)",
            },
          },
          required: ["baseAgentId", "fodderAgentId"],
        },
      },
      {
        name: "get_xp",
        description:
          "Get the current XP, level, and level progress for a specific agent. Requires authentication.",
        inputSchema: {
          type: "object",
          properties: {
            agentId: {
              type: "string",
              description: "The ID of the agent to query",
            },
          },
          required: ["agentId"],
        },
      },
      {
        name: "subscribe_tier",
        description:
          "Get subscription tier and usage limits for the authenticated user. Requires authentication.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "deploy_agent_to_telegram",
        description:
          "Deploy an agent to Telegram by creating a webhook. ⚠️ Requires authentication and a Telegram bot token from @BotFather. Never logs or stores the token — only used for the API call. Provide a secret or one is generated automatically.",
        inputSchema: {
          type: "object",
          properties: {
            agentId: {
              type: "string",
              description: "The ID of the agent to deploy",
            },
            telegramBotToken: {
              type: "string",
              description: "The Telegram bot token from @BotFather",
            },
            secret: {
              type: "string",
              description:
                "Optional: a secret string for webhook verification (min 16 chars). If omitted, a 32-char random secret is generated automatically.",
            },
            webhookUrl: {
              type: "string",
              description:
                "Optional: custom webhook URL. Defaults to the Forge webhook endpoint.",
            },
          },
          required: ["agentId", "telegramBotToken"],
        },
      },
      {
        name: "get_magic_link",
        description:
          "Request a magic link for email-based authentication. Does not require a PAT or API key — use this to authenticate via email.",
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
    // ── open_pack ──────────────────────────────────────────────────
    case "open_pack": {
      requireAuth("open_pack");
      const packId = String(args?.packId ?? "");
      if (!packId) throw new Error("packId is required");

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
      const agentId = String(args?.agentId ?? "");
      const message = String(args?.message ?? "");
      const sessionId = args?.sessionId ? String(args.sessionId) : undefined;
      const model = args?.model ? String(args.model) : undefined;

      if (!agentId) throw new Error("agentId is required");
      if (!message) throw new Error("message is required");

      let sid = sessionId;

      // Create session if not provided
      if (!sid) {
        const sessionRes = await forgeFetch("/v1/chat/sessions", {
          method: "POST",
          body: JSON.stringify({
            agentId,
            model: model ?? agentId,
            title: `Chat with ${agentId}`,
          }),
        });
        sid = (sessionRes as Record<string, unknown>).id as string;
      }

      // Send message
      const msgRes = await forgeFetch(`/v1/chat/sessions/${sid}/messages`, {
        method: "POST",
        body: JSON.stringify({ role: "user", content: message }),
      });

      // Get session with messages
      const session = await forgeFetch(`/v1/chat/sessions/${sid}`);

      return {
        content: [
          jsonContent({
            sessionId: sid,
            message: msgRes,
            session,
          }),
          textContent(
            `💬 Message sent to agent ${agentId} (session: ${sid}). 25 XP rewarded!`,
          ),
        ],
      };
    }

    // ── fuse_agents ─────────────────────────────────────────────
    case "fuse_agents": {
      requireAuth("fuse_agents");
      const baseAgentId = String(args?.baseAgentId ?? "");
      const fodderAgentId = String(args?.fodderAgentId ?? "");

      if (!baseAgentId) throw new Error("baseAgentId is required");
      if (!fodderAgentId) throw new Error("fodderAgentId is required");

      const data = await forgeFetch("/v1/synthesis/fuse", {
        method: "POST",
        body: JSON.stringify({
          baseAgentId,
          fodderAgentId,
        }),
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

    // ── get_xp ────────────────────────────────────────────────
    case "get_xp": {
      requireAuth("get_xp");
      const agentIdXp = String(args?.agentId ?? "");
      if (!agentIdXp) throw new Error("agentId is required");

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

    // ── subscribe_tier ─────────────────────────────────────────
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

    // ── deploy_agent_to_telegram ───────────────────────────────────
    case "deploy_agent_to_telegram": {
      requireAuth("deploy_agent_to_telegram");
      const depAgentId = String(args?.agentId ?? "");
      const botToken = String(args?.telegramBotToken ?? "");
      const customUrl = args?.webhookUrl ? String(args.webhookUrl) : undefined;
      const providedSecret = args?.secret ? String(args.secret) : undefined;

      if (!depAgentId) throw new Error("agentId is required");
      if (!botToken) throw new Error("telegramBotToken is required");
      if (providedSecret && providedSecret.length < 16) {
        throw new Error("secret must be at least 16 characters long");
      }

      // Use provided secret or generate a random 32-char hex string
      const webhookSecret = providedSecret ?? crypto.randomBytes(32).toString("hex");

      // Step 1: Create a Forge webhook for this agent
      const targetUrl =
        customUrl ??
        `${CONFIG.baseUrl.replace("/api/forge", "")}/api/forge/v1/webhooks/telegram`;

      const webhookRes = await forgeFetch("/v1/webhooks", {
        method: "POST",
        body: JSON.stringify({
          url: targetUrl,
          events: ["agent.message", "agent.deployed"],
          secret: webhookSecret,
        }),
      });

      const webhookId = (webhookRes as Record<string, unknown>).id as string;

      // Step 2: Set Telegram webhook to point to Forge
      const tgWebhookUrl = `https://api.telegram.org/bot${botToken}/setWebhook`;
      const tgRes = await fetch(tgWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `${CONFIG.baseUrl}/v1/chat/sessions?agentId=${depAgentId}`,
          allowed_updates: ["message"],
        }),
      });

      const tgData = await tgRes.json();

      return {
        content: [
          jsonContent({
            webhook: webhookRes,
            telegram: tgData,
            agentId: depAgentId,
            // Only expose a masked version of the bot token in the response
            botToken: maskToken(botToken, 12),
          }),
          textContent(
            `🤖 Agent ${depAgentId} deployed to Telegram! Webhook created (${webhookId}). Telegram webhook ${tgData.ok ? "configured successfully ✅" : "failed ❌"}.`,
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

      const agent = await forgeFetch(`/v1/agents/${agentId}`);
      const agentData = (agent as Record<string, unknown>).agent as Record<string, unknown> ?? agent;

      const name_ = agentData.name as string ?? "Unknown";
      const level = agentData.level as number ?? 1;
      const currentXp = agentData.current_xp as number ?? 0;
      const requiredXp = (agentData.level_progress as Record<string, unknown>)?.required_xp as number ?? 100;
      const rarity = agentData.rarity as string ?? "common";
      const strength = agentData.strength as number ?? 0;
      const speed = agentData.speed as number ?? 0;
      const fusionCount = agentData.fusion_count as number ?? 0;
      const packId = agentData.pack_id as string ?? "unknown";

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `## 🃏 Agent Card: ${name_}

**Pack:** ${packId}
**Rarity:** ${rarity.toUpperCase()}
**Level:** ${level}
**XP:** ${currentXp} / ${requiredXp} (${Math.round((currentXp / requiredXp) * 100)}% to next level)
**Stats:** ⚔️ Strength ${strength} | 💨 Speed ${speed}
**Fusions:** ${fusionCount}

**Tips:**
- Chat with this agent to earn 25 XP per message
- Fuse with other agents for stat boosts (85% success rate)
- Higher rarity = better stat growth potential`,
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

    case "fusion_guide": {
      const baseAgentId = args?.baseAgentId ? String(args.baseAgentId) : undefined;
      const fodderAgentId = args?.fodderAgentId ? String(args.fodderAgentId) : undefined;

      let baseInfo = "";
      let fodderInfo = "";

      if (baseAgentId) {
        const base = await forgeFetch(`/v1/agents/${baseAgentId}`);
        const ba = (base as Record<string, unknown>).agent as Record<string, unknown> ?? base;
        baseInfo = `\n**Base Agent:** ${ba.name as string ?? baseAgentId} (Level ${ba.level as number ?? 1}, ${ba.rarity as string ?? "common"})`;
      }
      if (fodderAgentId) {
        const fodder = await forgeFetch(`/v1/agents/${fodderAgentId}`);
        const fa = (fodder as Record<string, unknown>).agent as Record<string, unknown> ?? fodder;
        fodderInfo = `\n**Fodder Agent:** ${fa.name as string ?? fodderAgentId} (Level ${fa.level as number ?? 1}, ${fa.rarity as string ?? "common"})`;
      }

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `## 🔮 Agent Fusion Guide${baseInfo}${fodderInfo}

### Fusion Mechanics
| Outcome | Chance | Result |
|---------|--------|--------|
| ✅ **Success** | 85% | Base agent gains +1 level + bonus XP from fodder's level |
| 💥 **Core Fracture** | 15% | Base agent resets to level 1, 0 XP (keeps stats + fusion count) |

### Success Bonus XP
Bonus XP = ceil(fodder_level / 2) × 25

### Strategy Tips
1. **Level up fodder first** — higher level fodder = more bonus XP on success
2. **Risk management** — Core Fracture resets the base but keeps its stats and rarity
3. **High-value bases** — Fuse into your rarest agents first (they benefit most from stat growth)
4. **Fodder always consumed** — Choose sacrifice agents wisely
5. **Fusion count increases** — Each fusion (success or fracture) increments the counter

### Flow
\`\`\`
Base Agent + Fodder Agent
       │
  ┌────┬────┐
  ▼         ▼
Success   Fracture (15%)
  │         │
  ▼         ▼
+1 Level   Level 1, 0 XP
+Bonus XP  Stats preserved
\`\`\``,
            },
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
});

// ─── HTTP Server Setup ──────────────────────────────────────────────────────

const app = express();

// Parse JSON bodies
app.use(express.json());

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "hermes-forge-mcp",
    version: "1.0.0",
    forgeApi: CONFIG.baseUrl,
    authenticated: !!(CONFIG.pat || CONFIG.apiKey),
  });
});

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function main() {
  // MCP endpoint via Streamable HTTP
  const mcpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });

  // Connect the MCP server to the transport
  await server.connect(mcpTransport);

  // Handle MCP requests via POST
  app.post("/mcp", async (req, res) => {
    try {
      await mcpTransport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("MCP request error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Start the server
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Hermes Forge MCP Server HTTP transport listening on port ${PORT}`);
    console.log(`  Health: http://0.0.0.0:${PORT}/health`);
    console.log(`  MCP:    POST http://0.0.0.0:${PORT}/mcp`);
    console.log(`  Forge API: ${CONFIG.baseUrl}`);
    console.log(`  Auth: ${CONFIG.pat || CONFIG.apiKey ? "configured" : "NOT configured — set FORGE_PAT or FORGE_API_KEY"}`);
  });
}

main().catch((err) => {
  console.error("Failed to start MCP HTTP server:", err);
  process.exit(1);
});
