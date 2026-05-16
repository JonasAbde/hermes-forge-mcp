/**
 * Forge MCP — Auto-Discovery Module
 *
 * At startup, probes the Forge API to discover available endpoints.
 * Logs any endpoints that aren't yet exposed as MCP tools.
 * Does NOT auto-register tools — purely for awareness/monitoring.
 */

import logger from "./logger.js";
import { getConfig } from "./shared.js";

// ─── Known MCP tools & their API paths ────────────────────────────────

/**
 * Map of currently registered MCP tools to their underlying API paths.
 * Used to detect gaps between available API endpoints and exposed tools.
 */
const KNOWN_TOOL_PATHS: Record<string, string[]> = {
  forge_list_packs: ["/packs"],
  forge_get_pack: ["/packs/"],
  forge_search_packs: ["/packs?search="],
  open_pack: ["/v1/agents"],
  forge_list_agents: ["/v1/agents"],
  forge_get_agent: ["/v1/agents/"],
  forge_agent_traits: ["/v1/agents//traits"],
  forge_agent_lineage: ["/v1/agents//lineage"],
  forge_list_agent_runs: ["/v1/agents//runs"],
  chat_with_agent: ["/v1/chat/sessions"],
  fuse_agents: ["/v1/synthesis/fuse"],
  forge_list_activities: ["/v1/activities"],
  forge_list_deployments: ["/v1/deployments"],
  subscribe_tier: ["/v1/me/tier"],
  forge_get_profile: ["/v1/me/profile", "/v1/me"],
  deploy_agent_to_telegram: ["/v1/webhooks"],
  forge_list_missions: ["/v1/missions"],
  forge_start_mission: ["/v1/missions/start"],
  forge_complete_mission: ["/v1/missions/complete"],
  forge_claim_mission_reward: ["/v1/missions/claim-daily"],
  forge_list_leaderboard: ["/packs/leaderboard"],
  get_magic_link: ["/v1/auth/magic"],
};

// ─── Endpoint Discovery ───────────────────────────────────────────────

/** Endpoints to probe for discovery. */
const PROBE_ENDPOINTS = [
  // Pack endpoints
  { method: "GET", path: "/packs", description: "List all Agent Packs" },
  { method: "GET", path: "/packs/{packId}", description: "Get pack details" },
  { method: "GET", path: "/packs?search=", description: "Search packs" },
  { method: "GET", path: "/packs/leaderboard", description: "List top packs" },
  // Auth endpoints
  { method: "POST", path: "/v1/auth/magic", description: "Request magic link" },
  // Agent endpoints
  { method: "GET", path: "/v1/agents", description: "List user's agents" },
  { method: "GET", path: "/v1/agents/{agentId}", description: "Get agent details" },
  { method: "POST", path: "/v1/agents", description: "Open/create an agent" },
  { method: "GET", path: "/v1/agents/{agentId}/traits", description: "Agent personality traits" },
  { method: "GET", path: "/v1/agents/{agentId}/lineage", description: "Agent fusion lineage" },
  { method: "GET", path: "/v1/agents/{agentId}/runs", description: "Agent mission runs" },
  // Chat endpoints
  { method: "POST", path: "/v1/chat/sessions", description: "Create chat session" },
  { method: "POST", path: "/v1/chat/sessions/{id}/messages", description: "Send message" },
  // Synthesis endpoints
  { method: "POST", path: "/v1/synthesis/fuse", description: "Fuse two agents" },
  // User endpoints
  { method: "GET", path: "/v1/me", description: "Get current user" },
  { method: "GET", path: "/v1/me/tier", description: "Get subscription tier" },
  { method: "GET", path: "/v1/me/profile", description: "Get user profile" },
  // Mission endpoints
  { method: "GET", path: "/v1/missions", description: "List missions" },
  { method: "POST", path: "/v1/missions/start", description: "Start mission" },
  { method: "POST", path: "/v1/missions/complete", description: "Complete mission" },
  { method: "POST", path: "/v1/missions/claim-daily", description: "Claim daily reward" },
  // Webhook endpoints
  { method: "POST", path: "/v1/webhooks", description: "Create webhook" },
  { method: "GET", path: "/v1/deployments", description: "List deployments" },
  { method: "GET", path: "/v1/activities", description: "List activities" },
];

/**
 * Check if an API endpoint is already covered by an existing MCP tool.
 */
function isEndpointCovered(_method: string, path: string): boolean {
  const basePath = path.split("{")[0]; // strip path params
  for (const toolPaths of Object.values(KNOWN_TOOL_PATHS)) {
    for (const tp of toolPaths) {
      const baseToolPath = tp.split("{")[0];
      if (basePath.startsWith(baseToolPath) || baseToolPath.startsWith(basePath)) {
        return true;
      }
    }
  }
  return false;
}

// ─── API Schema Discovery ─────────────────────────────────────────────

/**
 * Try to fetch an OpenAPI spec from the Forge API.
 * Returns the parsed spec or null.
 */
async function fetchOpenApiSpec(baseUrl: string): Promise<Record<string, unknown> | null> {
  const candidates = [
    "/openapi.json",
    "/openapi",
    "/swagger.json",
    "/api-docs",
    "/v1/openapi.json",
  ];

  for (const candidate of candidates) {
    try {
      const url = `${baseUrl}${candidate}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const spec = await res.json();
        logger.info(`Found API schema at ${candidate}`);
        return spec as Record<string, unknown>;
      }
    } catch {
      // Not found or unavailable, try next candidate
    }
  }
  return null;
}

// ─── Main Auto-Discovery ──────────────────────────────────────────────

export interface DiscoveryResult {
  baseUrl: string;
  openApiSpecFound: boolean;
  probedEndpoints: number;
  uncoveredEndpoints: string[];
  error?: string;
}

/**
 * Run auto-discovery of Forge API endpoints.
 * Logs findings via the structured logger.
 * Does NOT register any new tools — purely informational.
 */
export async function autoDiscovery(): Promise<DiscoveryResult> {
  const cfg = getConfig();
  const baseUrl = cfg.baseUrl;
  const uncoveredEndpoints: string[] = [];

  try {
    // 1. Try to fetch OpenAPI spec
    const spec = await fetchOpenApiSpec(baseUrl);
    const openApiSpecFound = spec !== null;

    if (spec) {
      // If we found a spec, parse paths from it
      const paths = spec.paths as Record<string, unknown> | undefined;
      if (paths) {
        for (const [path, methods] of Object.entries(paths)) {
          const methodObj = methods as Record<string, unknown>;
          const method = Object.keys(methodObj)[0]?.toUpperCase() ?? "GET";
          if (!isEndpointCovered(method, path)) {
            uncoveredEndpoints.push(`${method} ${path}`);
          }
        }
      }
    } else {
      // 2. No spec found — probe known endpoints with HEAD/GET
      logger.info("No OpenAPI spec found — probing known endpoints");
      for (const ep of PROBE_ENDPOINTS) {
        try {
          const url = `${baseUrl}${ep.path.replace(/\{[^}]+\}/g, "test")}`;
          const res = await fetch(url, {
            method: ep.method === "GET" ? "GET" : "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              ...(cfg.pat ? { Authorization: `Bearer ${cfg.pat}` } : {}),
            },
            signal: AbortSignal.timeout(5000),
          });

          if (res.status !== 404 && !isEndpointCovered(ep.method, ep.path)) {
            const status =
              res.status === 401
                ? " (requires auth)"
                : ` (HTTP ${res.status})`;
            uncoveredEndpoints.push(`${ep.method} ${ep.path}${status}`);
          }
        } catch {
          // Timeout or network error — skip
        }
      }

      // Check for search/leaderboard endpoints
      const extraEndpoints = [
        { method: "GET", path: "/v1/search" },
        { method: "GET", path: "/search" },
        { method: "GET", path: "/v1/leaderboard" },
        { method: "GET", path: "/leaderboard" },
        { method: "GET", path: "/v1/ranking" },
        { method: "GET", path: "/ranking" },
      ];

      for (const ep of extraEndpoints) {
        try {
          const url = `${baseUrl}${ep.path}`;
          const res = await fetch(url, {
            method: "GET",
            headers: {
              Accept: "application/json",
              ...(cfg.pat ? { Authorization: `Bearer ${cfg.pat}` } : {}),
            },
            signal: AbortSignal.timeout(5000),
          });
          if (res.status !== 404) {
            uncoveredEndpoints.push(
              `${ep.method} ${ep.path} (HTTP ${res.status})`,
            );
          }
        } catch {
          // skip
        }
      }
    }

    // 3. Log results
    if (uncoveredEndpoints.length > 0) {
      logger.info("Auto-discovery: uncovered API endpoints found", {
        count: uncoveredEndpoints.length,
        endpoints: uncoveredEndpoints,
      });
    } else {
      logger.info("Auto-discovery: all known API endpoints are covered by MCP tools");
    }

    return {
      baseUrl,
      openApiSpecFound,
      probedEndpoints: PROBE_ENDPOINTS.length,
      uncoveredEndpoints,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn("Auto-discovery encountered an error", { error: errorMsg });
    return {
      baseUrl,
      openApiSpecFound: false,
      probedEndpoints: 0,
      uncoveredEndpoints: [],
      error: errorMsg,
    };
  }
}
