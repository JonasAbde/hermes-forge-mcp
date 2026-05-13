/**
 * Forge MCP — Shared Module
 *
 * All duplicated code between index.ts and http-server.ts lives here.
 * Config, auth, API client, MCP handler registration functions.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
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
  recordCacheHit,
  recordCacheMiss,
} from "./resilience.js";

/** Default timeout for Forge API calls (15 seconds). */
const FORGE_FETCH_TIMEOUT_MS = 15_000;
import { shouldCache, getCacheForPath } from "./cache.js";
import logger from "./logger.js";
import {
  analyzeChat,
  getOrCreateEvolutionState,
  getEvolutionState,
  recordFusion,
  getLineage,
  getFamilyTree,
} from "./evolution.js";

// ─── ForgeTool Type ───────────────────────────────────────────────────

export interface ForgeTool {
  name: string;
  description: string;
}

// ─── Auth & Config ─────────────────────────────────────────────────────

export interface ForgeConfig {
  baseUrl: string;
  pat?: string;
  apiKey?: string;
  email?: string;
}

function loadConfig(): ForgeConfig {
  return {
    baseUrl:
      process.env.FORGE_API_BASE_URL ?? "https://forge.tekup.dk/api/forge",
    pat: process.env.FORGE_PAT,
    apiKey: process.env.FORGE_API_KEY,
    email: process.env.FORGE_EMAIL,
  };
}

let loadedConfig: ForgeConfig | null = null;

export function getConfig(): ForgeConfig {
  if (!loadedConfig) {
    loadedConfig = loadConfig();
  }
  return loadedConfig;
}

// ─── Token Masking ───────────────────────────────────────────────────

/** Mask a sensitive token, showing only the first and last few characters. */
export function maskToken(
  token: string | undefined,
  visibleChars = 8,
): string {
  if (!token || token.length <= visibleChars + 4) return "***";
  const head = token.slice(0, visibleChars);
  const tail = token.slice(-4);
  return `${head}...${tail}`;
}

/** Check whether the current config has authentication configured. */
export function hasAuth(): boolean {
  const cfg = getConfig();
  return !!(cfg.pat || cfg.apiKey);
}

/** Build auth headers from config */
export function authHeaders(): Record<string, string> {
  const cfg = getConfig();
  const h: Record<string, string> = {};
  if (cfg.pat) {
    h["Authorization"] = `Bearer ${cfg.pat}`;
  } else if (cfg.apiKey) {
    h["Authorization"] = `Bearer ${cfg.apiKey}`;
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
export class AuthRequiredError extends Error {
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
export function requireAuth(toolName: string): void {
  if (!hasAuth()) {
    throw new AuthRequiredError(toolName);
  }
}

/** Build a safe error message that never leaks raw tokens. */
export function safeErrorMessage(_context: string, raw: string): string {
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

export interface ForgeResponse<T = unknown> {
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
export async function forgeFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
  validateResponse = false,
): Promise<ForgeResponse<T>> {
  const cfg = getConfig();
  const url = `${cfg.baseUrl}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...authHeaders(),
    ...(options.headers as Record<string, string> | undefined),
  };

  // ── Cache Check ─────────────────────────────────────────────────────
  const method = (options.method ?? "GET").toUpperCase();
  const shouldCheckCache = shouldCache(method, path);
  if (shouldCheckCache) {
    const cache = getCacheForPath(path);
    const cached = cache.get(path);
    if (cached !== undefined) {
      recordCacheHit();
      return cached as ForgeResponse<T>;
    }
    recordCacheMiss();
  }

  const fetchFn = async (): Promise<ForgeResponse<T>> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FORGE_FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

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
          throw new Error(
            safeErrorMessage(
              "forgeFetch",
              `API response shape validation failed for ${path}. The API contract may have changed. ` +
                `Warnings: ${warnings.join("; ")}`,
            ),
          );
        }
      }

      if ((body as Record<string, unknown>).status === "error") {
        const detail =
          (body as Record<string, unknown>).error ??
          (body as Record<string, unknown>).detail ??
          "Forge API error";
        throw new Error(safeErrorMessage("forgeFetch", String(detail)));
      }

      return body as ForgeResponse<T>;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        logger.warn(
          "Forge API request timed out",
          { url, timeoutMs: FORGE_FETCH_TIMEOUT_MS },
        );
        throw err;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const result = await exponentialBackoffRetry(fetchFn, {
      maxRetries: 2,
      baseDelayMs: 100,
    });

    // ── Cache Store ──────────────────────────────────────────────
    if (shouldCheckCache) {
      const cache = getCacheForPath(path);
      cache.set(path, result);
    }

    return result;
  } catch (err) {
    recordHealth(false, 0);
    throw err;
  }
}

// ─── Helpers ──────────────────────────────────────────────────

export function textContent(text: string) {
  return { type: "text" as const, text };
}

export function jsonContent(data: unknown) {
  return { type: "text" as const, text: JSON.stringify(data, null, 2) };
}

// ─── MCP Tool Schemas (ListToolsRequestSchema handler) ────────────────

/**
 * Register the ListToolsRequestSchema handler on the server and return
 * the tool definitions array (usable by transports for health endpoints).
 *
 * Uses canonical camelCase parameter names (http-server.ts style).
 */
export function createMCPToolSchemas(
  server: Server,
): Array<{ name: string; description: string; inputSchema: unknown }> {
  const tools = [
    {
      name: "forge_list_packs",
      description:
        "List Agent Packs from the Forge catalog. Optionally filter by query, theme, or sort order.",
      inputSchema: {
        type: "object",
        properties: {
          catalogOnly: {
            type: "boolean",
            description:
              "If true, only return catalog-eligible packs",
            default: true,
          },
          sort: {
            type: "string",
            description:
              "Sort order: trust-desc, trust-asc, or name-asc",
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
          packId: {
            type: "string",
            description:
              "The pack ID (e.g., 'hermes-agent')",
          },
        },
        required: ["packId"],
      },
    },
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
            description:
              "The ID of the agent to chat with",
          },
          message: {
            type: "string",
            description:
              "The message content to send",
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
            description:
              "The ID of the base agent (survives on success)",
          },
          fodderAgentId: {
            type: "string",
            description:
              "The ID of the fodder/sacrifice agent (consumed)",
          },
        },
        required: ["baseAgentId", "fodderAgentId"],
      },
    },
    {
      name: "forge_get_agent",
      description:
        "Get full details for a specific agent including XP, level, stats, rarity, and fusion history. Requires authentication.",
      inputSchema: {
        type: "object",
        properties: {
          agentId: {
            type: "string",
            description:
              "The ID of the agent to query",
          },
        },
        required: ["agentId"],
      },
    },
    {
      name: "forge_list_leaderboard",
      description:
        "List top Agent Packs sorted by trust score — the Forge leaderboard. Shows the highest-rated and most trusted packs.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            description:
              "Maximum number of leaderboard entries to return (default: 20)",
            default: 20,
          },
        },
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
            description:
              "The ID of the agent to deploy",
          },
          telegramBotToken: {
            type: "string",
            description:
              "The Telegram bot token from @BotFather",
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
            description:
              "Email address to send the magic link to",
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
    // ── Evolution Tools ───────────────────────────────────────
    {
      name: "forge_agent_traits",
      description:
        "List all unlocked traits, abilities, and evolution progress for an agent. Shows chat topic frequencies and evolution stage. Requires authentication.",
      inputSchema: {
        type: "object",
        properties: {
          agentId: {
            type: "string",
            description:
              "The ID of the agent to query for evolution state",
          },
        },
        required: ["agentId"],
      },
    },
    {
      name: "forge_agent_lineage",
      description:
        "View the fusion genealogy (family tree) for an agent — fusion history, parent agents, children, and lineage depth. Requires authentication.",
      inputSchema: {
        type: "object",
        properties: {
          agentId: {
            type: "string",
            description:
              "The ID of the agent to view lineage for",
          },
          generations: {
            type: "integer",
            description:
              "How many generations of ancestors/descendants to show (default: 3, max: 10)",
            default: 3,
          },
        },
        required: ["agentId"],
      },
    },
    // ── User Profile & Data Tools ──────────────────────────
    {
      name: "forge_get_profile",
      description:
        "Get the authenticated user's full profile — XP, level, tier, loadout, agent count, fusion count, and subscription status. Requires authentication.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "forge_list_agents",
      description:
        "List all agents owned by the authenticated user — name, level, XP, rarity, fusion count, pack source. Supports filtering by rarity. Requires authentication.",
      inputSchema: {
        type: "object",
        properties: {
          rarity: {
            type: "string",
            description:
              "Optional filter by rarity: common, uncommon, rare, epic, legendary",
          },
          limit: {
            type: "integer",
            description:
              "Maximum number of agents to return (default: 50)",
            default: 50,
          },
        },
      },
    },
    {
      name: "forge_list_deployments",
      description:
        "List all active Telegram and webhook deployments for the authenticated user. Includes webhook URL, agent ID, status, and creation date. Requires authentication.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            description:
              "Maximum number of deployments to return",
          },
        },
      },
    },
    {
      name: "forge_list_activities",
      description:
        "List recent activity feed for the authenticated user — missions completed, achievements unlocked, agents fused, packs opened, and other events. Requires authentication.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            description:
              "Maximum number of activities to return (default: 20)",
            default: 20,
          },
        },
      },
    },
    {
      name: "forge_list_agent_runs",
      description:
        "List execution history for agents — timestamps, models used, message counts, and status of each run. Requires authentication.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            description:
              "Maximum number of runs to return (default: 20)",
            default: 20,
          },
          agentId: {
            type: "string",
            description:
              "Optional filter by agent ID",
          },
        },
      },
    },
    {
      name: "forge_search_packs",
      description:
        "Search the full Forge catalog for Agent Packs by keyword. Searches pack names, descriptions, tags, and IDs. No authentication required.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Search keyword to find packs by name, description, tags, or ID",
          },
          limit: {
            type: "integer",
            description:
              "Maximum number of results to return (default: 20)",
            default: 20,
          },
          offset: {
            type: "integer",
            description:
              "Number of results to skip for pagination (default: 0)",
            default: 0,
          },
        },
        required: ["query"],
      },
    },
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  return tools;
}

// ─── Resource Handlers ───────────────────────────────────────────────

/**
 * Register the ListResourcesRequestSchema and ReadResourceRequestSchema
 * handlers on the server.
 */
export function createResourceHandlers(
  server: Server,
  fetchFn: typeof forgeFetch,
  authFn: typeof requireAuth,
): void {
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: "forge://packs",
          name: "Agent Packs Catalog",
          description:
            "List all Agent Packs available in the Hermes Forge catalog",
          mimeType: "application/json",
        },
        {
          uri: "forge://agents",
          name: "My Agents",
          description:
            "List the authenticated user's collected agents with XP, level, and stats",
          mimeType: "application/json",
        },
        {
          uri: "forge://user/profile",
          name: "User Profile",
          description:
            "Get the authenticated user's profile information",
          mimeType: "application/json",
        },
        {
          uri: "forge://agents/{agentId}/evolution",
          name: "Agent Evolution State",
          description:
            "Get the evolution state, unlocked traits, and topic progress for a specific agent",
          mimeType: "application/json",
        },
        {
          uri: "forge://agents/{agentId}/lineage",
          name: "Agent Lineage / Genealogy",
          description:
            "View the fusion genealogy (family tree) for a specific agent",
          mimeType: "application/json",
        },
      ],
    };
  });

  server.setRequestHandler(
    ReadResourceRequestSchema,
    async (request) => {
      const uri = request.params.uri;

      switch (uri) {
        case "forge://packs": {
          const data = await fetchFn("/packs");
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
          authFn("forge://agents");
          const data = await fetchFn("/v1/agents");
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
          authFn("forge://user/profile");
          const data = await fetchFn("/v1/me/profile");
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

        default: {
          // Check for evolution resource URI pattern
          const evoMatch = uri.match(
            /^forge:\/\/agents\/([^/]+)\/evolution$/,
          );
          if (evoMatch) {
            authFn(uri);
            const agentId = evoMatch[1];
            const evoState = getEvolutionState(agentId);
            return {
              contents: [
                {
                  uri,
                  mimeType: "application/json",
                  text: JSON.stringify(
                    evoState ?? {
                      agentId,
                      message:
                        "No evolution data found for this agent",
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          // Check for lineage resource URI pattern
          const lineageMatch = uri.match(
            /^forge:\/\/agents\/([^/]+)\/lineage$/,
          );
          if (lineageMatch) {
            authFn(uri);
            const agentId = lineageMatch[1];
            const lineage = getLineage(agentId);
            return {
              contents: [
                {
                  uri,
                  mimeType: "application/json",
                  text: JSON.stringify(
                    lineage ?? {
                      agentId,
                      message:
                        "No lineage data found for this agent. Fuse agents to create a lineage!",
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          throw new Error(`Unknown resource URI: ${uri}`);
        }
      }
    },
  );
}

// ─── Tool Handlers (CallToolRequestSchema) ────────────────────────────

/**
 * Register the CallToolRequestSchema handler on the server.
 *
 * Uses the richer http-server.ts implementations as canonical.
 */
export function createToolHandlers(
  server: Server,
  fetchFn: typeof forgeFetch,
  authFn: typeof requireAuth,
): void {
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request) => {
      const { name, arguments: args } = request.params;
      const startTime = Date.now();

      try {
        switch (name) {
        // ── forge_list_packs ─────────────────────────────────────────
        case "forge_list_packs": {
          const catalogOnly = args?.catalogOnly !== false;
          const sort = String(args?.sort ?? "trust-desc");
          const query = String(args?.query ?? "").trim();
          const theme = String(args?.theme ?? "").trim();

          const params = new URLSearchParams();
          params.set("sort", sort);
          if (catalogOnly) params.set("catalog", "1");
          if (query) params.set("q", query);
          if (theme) params.set("theme", theme);

          const data = await fetchFn(`/packs?${params.toString()}`);
          const packs = (data as Record<string, unknown>)
            ?.packs as unknown[] | undefined;
          const count = packs?.length ?? 0;

          return {
            content: [
              jsonContent(data),
              textContent(
                `📦 Listed ${count} packs from Forge catalog. Use forge_get_pack for details on a specific pack.`,
              ),
            ],
          };
        }

        // ── forge_get_pack ───────────────────────────────────────────
        case "forge_get_pack": {
          const packId = String(args?.packId ?? "");
          if (!packId) throw new Error("packId is required");

          const data = await fetchFn(
            `/packs/${encodeURIComponent(packId)}`,
          );

          return {
            content: [
              jsonContent(data),
              textContent(
                `📦 Retrieved details for pack "${packId}".`,
              ),
            ],
          };
        }

        // ── open_pack ──────────────────────────────────────────────────
        case "open_pack": {
          authFn("open_pack");
          const packId = String(args?.packId ?? "");
          if (!packId) throw new Error("packId is required");

          const data = await fetchFn("/v1/agents", {
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
          authFn("chat_with_agent");
          const agentId = String(args?.agentId ?? "");
          const message = String(args?.message ?? "");
          const sessionId = args?.sessionId
            ? String(args.sessionId)
            : undefined;
          const model = args?.model
            ? String(args.model)
            : undefined;

          if (!agentId) throw new Error("agentId is required");
          if (!message) throw new Error("message is required");

          let sid = sessionId;

          // Create session if not provided
          if (!sid) {
            const sessionRes = await fetchFn(
              "/v1/chat/sessions",
              {
                method: "POST",
                body: JSON.stringify({
                  agentId,
                  model: model ?? 'hermes-agent',
                  title: `Chat with ${agentId}`,
                  metadata: {
                    active_pack_ids: [agentId],
                  },
                }),
              },
            );
            // Platform returns { status: 'ok', session: { id: '...' } }
            const session = (
              sessionRes as Record<string, unknown>
            )?.session as Record<string, unknown> | undefined;
            sid = (session?.id as string) ?? (
              sessionRes as Record<string, unknown>
            ).id as string;
          }

          // Send message
          const msgRes = await fetchFn(
            `/v1/chat/sessions/${sid}/messages`,
            {
              method: "POST",
              body: JSON.stringify({
                role: "user",
                content: message,
              }),
            },
          );

          // Get session with messages
          const session = await fetchFn(
            `/v1/chat/sessions/${sid}`,
          );

          // ── Evolution: Analyze chat for topic unlocks ─────────────
          try {
            getOrCreateEvolutionState(agentId);
            const newTraits = analyzeChat(agentId, message, 1);
            const evoState = getEvolutionState(agentId);

            let evoMsg = "";
            if (newTraits.length > 0) {
              evoMsg = `\n🧬 **Evolution!** Agent unlocked: ${newTraits.map((t) => t.name).join(", ")}!`;
            }
            if (evoState && evoState.traits.length >= 2 && evoState.evolutionStage > 0) {
              evoMsg += `\n✨ Evolution Stage: ${evoState.evolutionStage} (${evoState.traits.length} traits unlocked)`;
            }

            return {
              content: [
                jsonContent({
                  sessionId: sid,
                  message: msgRes,
                  session,
                  evolution: evoState
                    ? {
                        traits: evoState.traits,
                        stage: evoState.evolutionStage,
                        topicProgress: evoState.topicCounters,
                      }
                    : undefined,
                }),
                textContent(
                  `💬 Message sent to agent ${agentId} (session: ${sid}). 25 XP rewarded!${evoMsg}`,
                ),
              ],
            };
          } catch (evoErr) {
            logger.warn("Evolution analysis failed", {
              error: String(evoErr),
            });
            // Fall back to normal response if evolution fails
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
        }

        // ── fuse_agents ─────────────────────────────────────────────
        case "fuse_agents": {
          authFn("fuse_agents");
          const baseAgentId = String(
            args?.baseAgentId ?? "",
          );
          const fodderAgentId = String(
            args?.fodderAgentId ?? "",
          );

          if (!baseAgentId)
            throw new Error("baseAgentId is required");
          if (!fodderAgentId)
            throw new Error("fodderAgentId is required");

          const data = await fetchFn(
            "/v1/synthesis/fuse",
            {
              method: "POST",
              body: JSON.stringify({
                baseAgentId,
                fodderAgentId,
              }),
            },
          );

          const result = (data as Record<string, unknown>)
            .result as string;
          const isSuccess = result === "success";
          const emoji = isSuccess ? "✨" : "💥";

          // ── Genealogy: Record fusion in lineage ──────────────────
          try {
            recordFusion({
              baseAgentId,
              fodderAgentId,
              baseName: baseAgentId,
              fodderName: fodderAgentId,
              success: isSuccess,
            });
          } catch (geneErr) {
            logger.warn("Genealogy recording failed", {
              error: String(geneErr),
            });
          }

          return {
            content: [
              jsonContent(data),
              textContent(
                `${emoji} Fusion ${result}! ${isSuccess ? "Base agent gained levels!" : "Core Fracture — base agent reset to level 1."}`,
              ),
            ],
          };
        }

        // ── forge_get_agent ────────────────────────────────────────────────
        case "forge_get_agent": {
          authFn("forge_get_agent");
          const agentIdXp = String(args?.agentId ?? "");
          if (!agentIdXp)
            throw new Error("agentId is required");

          const agent = await fetchFn(
            `/v1/agents/${agentIdXp}`,
          );

          return {
            content: [
              jsonContent(agent),
              textContent(
                `📊 XP details retrieved for ${agentIdXp}. See above for full stats.`,
              ),
            ],
          };
        }

        // ── forge_list_leaderboard ────────────────────────────────────
        case "forge_list_leaderboard": {
          const limit = Number(args?.limit ?? 20);

          const params = new URLSearchParams();
          params.set("sort", "trust-desc");
          params.set("catalog", "1");

          const data = await fetchFn(`/packs?${params.toString()}`);
          const packs = (data as Record<string, unknown>)
            ?.packs as unknown[] | undefined;
          const topPacks = packs?.slice(0, limit) ?? [];

          return {
            content: [
              jsonContent(data),
              textContent(
                `🏆 Top ${topPacks.length} packs by trust score. Use forge_get_pack to see details on any pack.`,
              ),
            ],
          };
        }

        // ── subscribe_tier ─────────────────────────────────────────
        case "subscribe_tier": {
          authFn("subscribe_tier");
          const data = await fetchFn("/v1/me/tier");

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
          authFn("deploy_agent_to_telegram");
          const depAgentId = String(args?.agentId ?? "");
          const botToken = String(
            args?.telegramBotToken ?? "",
          );
          const customUrl = args?.webhookUrl
            ? String(args.webhookUrl)
            : undefined;
          const providedSecret = args?.secret
            ? String(args.secret)
            : undefined;

          if (!depAgentId)
            throw new Error("agentId is required");
          if (!botToken)
            throw new Error("telegramBotToken is required");
          if (providedSecret && providedSecret.length < 16) {
            throw new Error(
              "secret must be at least 16 characters long",
            );
          }

          // Use provided secret or generate a random 32-char hex string
          const webhookSecret =
            providedSecret ??
            crypto.randomBytes(32).toString("hex");

          // Step 1: Create a Forge webhook for this agent
          const config = getConfig();
          const targetUrl =
            customUrl ??
            `${config.baseUrl.replace("/api/forge", "")}/api/forge/v1/webhooks/telegram`;

          const webhookRes = await fetchFn("/v1/webhooks", {
            method: "POST",
            body: JSON.stringify({
              url: targetUrl,
              events: [
                "agent.message",
                "agent.deployed",
              ],
              secret: webhookSecret,
            }),
          });

          const webhookId = (webhookRes as Record<string, unknown>)
            .id as string;

          // Step 2: Set Telegram webhook to point to Forge
          const tgWebhookUrl = `https://api.telegram.org/bot${botToken}/setWebhook`;
          const tgRes = await fetch(tgWebhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              url: `${config.baseUrl}/v1/chat/sessions?agentId=${depAgentId}`,
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

          if (!email)
            throw new Error("email is required");

          const data = await fetchFn("/v1/auth/magic", {
            method: "POST",
            body: JSON.stringify({ email, next }),
          });

          const devUrl = (
            data as Record<string, unknown>
          ).dev_verify_url as string | undefined;

          return {
            content: [
              jsonContent(data),
              textContent(
                `📧 Magic link sent to ${email}${devUrl ? `\n🔗 Dev verify URL: ${devUrl}` : ""}`,
              ),
            ],
          };
        }

        // ── forge_agent_traits ─────────────────────────────────────
        case "forge_agent_traits": {
          authFn("forge_agent_traits");
          const traitAgentId = String(args?.agentId ?? "");
          if (!traitAgentId)
            throw new Error("agentId is required");

          const evoState = getEvolutionState(traitAgentId);

          if (!evoState || evoState.traits.length === 0) {
            return {
              content: [
                jsonContent({
                  agentId: traitAgentId,
                  traits: [],
                  evolutionStage: 0,
                  totalChats: 0,
                  message:
                    "This agent has not yet unlocked any traits. Chat with it about different topics to unlock abilities!",
                }),
                textContent(
                  `🧬 Agent ${traitAgentId} has not evolved yet. Keep chatting to unlock traits!`,
                ),
              ],
            };
          }

          return {
            content: [
              jsonContent({
                agentId: traitAgentId,
                traits: evoState.traits,
                evolutionStage: evoState.evolutionStage,
                totalChats: evoState.totalChats,
                topicProgress: evoState.topicCounters,
              }),
              textContent(
                `🧬 **${traitAgentId} Evolution**\n` +
                  `Stage: ${evoState.evolutionStage}\n` +
                  `Traits: ${evoState.traits.length} unlocked\n` +
                  `Chats: ${evoState.totalChats}\n` +
                  `Evolved: ${evoState.lastEvolvedAt ? new Date(evoState.lastEvolvedAt).toLocaleDateString() : "Never"}`,
              ),
            ],
          };
        }

        // ── forge_agent_lineage ────────────────────────────────────
        case "forge_agent_lineage": {
          authFn("forge_agent_lineage");
          const lineageAgentId = String(args?.agentId ?? "");
          const generations = Math.min(
            Number(args?.generations ?? 3),
            10,
          );
          if (!lineageAgentId)
            throw new Error("agentId is required");

          const lineage = getLineage(lineageAgentId);
          const tree = getFamilyTree(lineageAgentId, generations);

          return {
            content: [
              jsonContent({
                agentId: lineageAgentId,
                lineage,
                familyTree: {
                  ancestors: tree.ancestors.length,
                  descendants: tree.descendants.length,
                  totalGenerations: generations,
                },
              }),
              textContent(
                `🌳 **${lineageAgentId} Genealogy**\n` +
                  `Fusions: ${lineage?.fusionRecords.length ?? 0}\n` +
                  `Ancestors: ${tree.ancestors.length} gen.\n` +
                  `Descendants: ${tree.descendants.length} gen.\n` +
                  `Created: ${tree.createdAt ? new Date(tree.createdAt).toLocaleDateString() : "Unknown"}`,
              ),
            ],
          };
        }

        // ── forge_get_profile ──────────────────────────────────────
        case "forge_get_profile": {
          authFn("forge_get_profile");
          const data = await fetchFn("/v1/me/profile");
          const profile = (data as Record<string, unknown>)?.profile as Record<string, unknown> | undefined;

          return {
            content: [
              jsonContent(data),
              textContent(
                `👤 **Profile Summary**\n` +
                  `XP Total: ${profile?.xp_total ?? "N/A"}\n` +
                  `Tier: ${profile?.tier ?? "N/A"}\n` +
                  `Agents: ${profile?.agent_count ?? "N/A"}\n` +
                  `Fusions: ${profile?.fusion_count ?? "N/A"}`,
              ),
            ],
          };
        }

        // ── forge_list_agents ──────────────────────────────────────
        case "forge_list_agents": {
          authFn("forge_list_agents");
          const rarityFilter = args?.rarity ? String(args.rarity).toLowerCase() : "";
          const limit = Number(args?.limit ?? 50);

          const data = await fetchFn("/v1/agents");
          const agents = ((data as Record<string, unknown>)?.agents as unknown[] | undefined) ?? (Array.isArray(data) ? data : []);

          let filtered = [...agents];
          if (rarityFilter) {
            filtered = filtered.filter((a: unknown) => {
              const agent = a as Record<string, unknown>;
              const r = String(agent?.rarity ?? "").toLowerCase();
              return r === rarityFilter;
            });
          }
          const sliced = filtered.slice(0, limit);

          return {
            content: [
              jsonContent(sliced),
              textContent(
                `🤖 Found ${sliced.length} agent(s)${rarityFilter ? ` (rarity: ${rarityFilter})` : ""}.`,
              ),
            ],
          };
        }

        // ── forge_list_deployments ────────────────────────────────
        case "forge_list_deployments": {
          authFn("forge_list_deployments");
          const depLimit = Number(args?.limit ?? 50);
          const data = await fetchFn("/v1/me/deployments");
          const deployments = (Array.isArray(data) ? data : (data as Record<string, unknown>)?.deployments as unknown[]) ?? [];
          const limited = deployments.slice(0, depLimit);

          return {
            content: [
              jsonContent(limited),
              textContent(
                `🌐 Found ${deployments.length} deployment(s), showing ${limited.length}.`,
              ),
            ],
          };
        }

        // ── forge_list_activities ──────────────────────────────────
        case "forge_list_activities": {
          authFn("forge_list_activities");
          const actLimit = Number(args?.limit ?? 20);
          const params = new URLSearchParams();
          params.set("limit", String(actLimit));

          const data = await fetchFn(`/v1/me/activities?${params.toString()}`);

          return {
            content: [
              jsonContent(data),
              textContent(
                `📜 Retrieved ${actLimit} recent activities.`,
              ),
            ],
          };
        }

        // ── forge_list_agent_runs ──────────────────────────────────
        case "forge_list_agent_runs": {
          authFn("forge_list_agent_runs");
          const runsLimit = Number(args?.limit ?? 20);
          const runsAgentId = args?.agentId ? String(args.agentId) : "";

          const params = new URLSearchParams();
          params.set("limit", String(runsLimit));
          if (runsAgentId) params.set("agentId", runsAgentId);

          const data = await fetchFn(`/v1/me/agent-runs?${params.toString()}`);

          return {
            content: [
              jsonContent(data),
              textContent(
                `⏱️ Retrieved agent run history${runsAgentId ? ` for agent ${runsAgentId}` : ""}.`,
              ),
            ],
          };
        }

        // ── forge_search_packs ────────────────────────────────────
        case "forge_search_packs": {
          const query = String(args?.query ?? "").trim();
          if (!query) throw new Error("query is required");

          const searchLimit = Number(args?.limit ?? 20);
          const offset = Number(args?.offset ?? 0);

          const params = new URLSearchParams();
          params.set("q", query);
          params.set("limit", String(searchLimit));
          params.set("offset", String(offset));

          const data = await fetchFn(`/v1/search?${params.toString()}`);

          return {
            content: [
              jsonContent(data),
              textContent(
                `🔍 Searched for "${query}".`,
              ),
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
        }
      } finally {
        const durationMs = Date.now() - startTime;
        logger.info("Tool called", { tool: name, durationMs });
      }
    },
  );
}

// ─── Prompt Handlers ────────────────────────────────────────────────

/**
 * Register the ListPromptsRequestSchema and GetPromptRequestSchema
 * handlers on the server.
 *
 * Uses the richer http-server.ts implementations as canonical.
 */
export function createPromptHandlers(
  server: Server,
  fetchFn: typeof forgeFetch,
  _authFn: typeof requireAuth,
): void {
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
              description:
                "The ID of the agent to generate a card for",
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
        {
          name: "evolution_report",
          description:
            "Generate an evolution report for an agent — unlocked traits, evolution stage, topic frequencies, and fusion genealogy.",
          arguments: [
            {
              name: "agentId",
              description:
                "The agent ID to generate the evolution report for",
              required: true,
            },
          ],
        },
      ],
    };
  });

  server.setRequestHandler(
    GetPromptRequestSchema,
    async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case "agent_card": {
          const agentId = String(args?.agentId ?? "");
          if (!agentId)
            throw new Error("agentId is required");

          const agent = await fetchFn(
            `/v1/agents/${agentId}`,
          );
          const agentData =
            ((agent as Record<string, unknown>)
              .agent as Record<string, unknown>) ??
            agent;

          const name_ =
            (agentData.name as string) ?? "Unknown";
          const level =
            (agentData.level as number) ?? 1;
          const currentXp =
            (agentData.current_xp as number) ?? 0;
          const requiredXp =
            (
              (agentData.level_progress as Record<string, unknown>)
                ?.required_xp as number
            ) ?? 100;
          const rarity =
            (agentData.rarity as string) ?? "common";
          const strength =
            (agentData.strength as number) ?? 0;
          const speed =
            (agentData.speed as number) ?? 0;
          const fusionCount =
            (agentData.fusion_count as number) ?? 0;
          const packId =
            (agentData.pack_id as string) ?? "unknown";

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
          if (!packId)
            throw new Error("packId is required");

          const data = await fetchFn(
            `/packs/${packId}`,
          );
          const d =
            data as Record<string, unknown>;
          const pack =
            (d.pack ??
              {}) as Record<string, unknown>;
          const metrics =
            (d.metrics ??
              {}) as Record<string, unknown>;
          const rating =
            (d.rating ??
              {}) as Record<string, unknown>;

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
          const baseAgentId = args?.baseAgentId
            ? String(args.baseAgentId)
            : undefined;
          const fodderAgentId = args?.fodderAgentId
            ? String(args.fodderAgentId)
            : undefined;

          let baseInfo = "";
          let fodderInfo = "";

          if (baseAgentId) {
            const base = await fetchFn(
              `/v1/agents/${baseAgentId}`,
            );
            const ba =
              ((base as Record<string, unknown>)
                .agent as Record<string, unknown>) ??
              base;
            baseInfo = `\n**Base Agent:** ${(ba.name as string) ?? baseAgentId} (Level ${(ba.level as number) ?? 1}, ${(ba.rarity as string) ?? "common"})`;
          }
          if (fodderAgentId) {
            const fodder = await fetchFn(
              `/v1/agents/${fodderAgentId}`,
            );
            const fa =
              ((fodder as Record<string, unknown>)
                .agent as Record<string, unknown>) ??
              fodder;
            fodderInfo = `\n**Fodder Agent:** ${(fa.name as string) ?? fodderAgentId} (Level ${(fa.level as number) ?? 1}, ${(fa.rarity as string) ?? "common"})`;
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

        case "evolution_report": {
          const evoAgentId = String(args?.agentId ?? "");
          if (!evoAgentId)
            throw new Error("agentId is required");

          const evoState = getEvolutionState(evoAgentId);
          const lineage = getLineage(evoAgentId);

          const traitsSection =
            evoState && evoState.traits.length > 0
              ? `\n**Unlocked Traits:**\n${evoState.traits.map((t) => `- ${t.name}: ${t.description}`).join("\n")}`
              : "\n**No traits unlocked yet.** Chat with this agent about various topics to unlock abilities!";

          const topicSection =
            evoState && evoState.topicCounters.length > 0
              ? `\n**Topic Progress:**\n${evoState.topicCounters.map((t) => `- ${t.topic}: ${t.count} mentions`).join("\n")}`
              : "";

          const lineageSection =
            lineage && lineage.fusionRecords.length > 0
              ? `\n**Fusion Genealogy:**\n${lineage.fusionRecords.map((r) => `- ${r.success ? "✅" : "💥"} ${r.baseName} + ${r.fodderName} (${new Date(r.timestamp).toLocaleDateString()})`).join("\n")}`
              : "\n**No fusion history yet.** Fuse agents to build a lineage!";

          return {
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: `## 🧬 Evolution Report: ${evoAgentId}

**Evolution Stage:** ${evoState?.evolutionStage ?? 0}
**Total Traits:** ${evoState?.traits.length ?? 0}
**Total Chats:** ${evoState?.totalChats ?? 0}${traitsSection}${topicSection}${lineageSection}

### Evolution Tips
- Chat about **data analysis, code, storytelling, strategy, humor, or empathy** to unlock traits
- Each trait needs **5 topic mentions** to unlock
- Unlock **2 traits** to advance evolution stage
- Higher evolution stages unlock **better fusion outcomes**`,
                },
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown prompt: ${name}`);
      }
    },
  );
}
