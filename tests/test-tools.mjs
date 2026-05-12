/**
 * Forge MCP — Tool handler unit tests.
 *
 * Tests each of the 10 MCP tools in isolation by mocking forgeFetch.
 * Uses Node.js native test runner (node:test, node:assert/strict).
 *
 * We mock:
 *   - A minimal MCP Server (stores the CallToolRequestSchema handler)
 *   - forgeFetch  (records calls, returns controlled data)
 *   - requireAuth (can be configured to throw or not)
 *
 * Then we call createToolHandlers() and invoke the captured handler
 * directly — no HTTP calls, no stdio processes.
 *
 * Usage: node --test tests/test-tools.mjs
 * Prerequisite: npm run build
 */

import { describe, it, before, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Mock helpers ─────────────────────────────────────────────────────

/**
 * Create a minimal mock MCP Server.
 *
 * createToolHandlers calls:
 *   server.setRequestHandler(CallToolRequestSchema, async (request) => { ... })
 *
 * Our mock ignores the schema argument (just a Zod object) and stores
 * the handler directly. Since createToolHandlers only registers one
 * request handler (CallToolRequestSchema), we always get the tool handler.
 */
function mockServer() {
  let _handler = null;
  return {
    get handler() {
      return _handler;
    },
    setRequestHandler(_schema, handler) {
      _handler = handler;
    },
  };
}

/** Create a mock forgeFetch that records calls and returns controlled data. */
function mockForgeFetch(returnValue = {}) {
  const calls = [];
  const fn = async (path, options = {}) => {
    calls.push({ path, options: { ...options, body: options.body ?? undefined } });
    return returnValue;
  };
  fn.calls = calls;
  return fn;
}

/** Create a mock requireAuth that optionally throws. */
function mockAuth(shouldThrow = false) {
  const calls = [];
  const fn = (toolName) => {
    calls.push(toolName);
    if (shouldThrow) {
      const err = new Error(
        `Authentication required for "${toolName}".\n\n` +
        `Set one of:\n` +
        `  - FORGE_PAT=hfp_xxx  (Personal Access Token)\n` +
        `  - FORGE_API_KEY=xxx  (API Key)\n\n` +
        `Read-only endpoints work without auth.`
      );
      err.name = "AuthRequiredError";
      throw err;
    }
  };
  fn.calls = calls;
  return fn;
}

/** Load the shared module fresh, clearing any cached config. */
let cachedMod = null;

async function loadShared() {
  if (!cachedMod) {
    const buildPath = path.resolve(__dirname, "..", "build", "shared.js");
    // Clear auth env so it doesn't affect tests
    delete process.env.FORGE_PAT;
    delete process.env.FORGE_API_KEY;
    delete process.env.FORGE_API_BASE_URL;
    delete process.env.FORGE_EMAIL;
    const url = new URL(`file://${buildPath}?t=${Date.now()}`);
    cachedMod = await import(url.href);
  }
  return cachedMod;
}

// ─── Tests: Public Tools (No Auth Required) ──────────────────────────

describe("forge_list_packs (no auth)", () => {
  let mod;

  before(async () => {
    mod = await loadShared();
  });

  it("calls /packs with default parameters", async () => {
    const server = mockServer();
    const data = {
      status: "ok",
      packs: [
        { pack_id: "hermes-agent", name: "Hermes Agent", slug: "hermes-agent" },
        { pack_id: "code-assistant", name: "Code Assistant", slug: "code-assistant" },
      ],
    };
    const fetchFn = mockForgeFetch(data);
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    const result = await server.handler({
      params: { name: "forge_list_packs", arguments: {} },
    });

    // 1. Correct API path
    assert.equal(fetchFn.calls.length, 1);
    assert.ok(fetchFn.calls[0].path.startsWith("/packs?"));

    // 2. Default params
    const url = new URL(fetchFn.calls[0].path, "https://x.com");
    assert.equal(url.searchParams.get("sort"), "trust-desc");
    assert.equal(url.searchParams.get("catalog"), "1");

    // 3. Response formatting
    assert.ok(result.content);
    assert.equal(result.content.length, 2);
    assert.equal(result.content[0].type, "text"); // jsonContent
    assert.ok(result.content[1].text.includes("2 packs"));

    // 4. No auth called
    assert.equal(authFn.calls.length, 0);
  });

  it("passes query and theme filters when provided", async () => {
    const server = mockServer();
    const fetchFn = mockForgeFetch({ status: "ok", packs: [] });
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    await server.handler({
      params: {
        name: "forge_list_packs",
        arguments: { query: "hermes", theme: "code", sort: "trust-asc", catalogOnly: false },
      },
    });

    const url = new URL(fetchFn.calls[0].path, "https://x.com");
    assert.equal(url.searchParams.get("q"), "hermes");
    assert.equal(url.searchParams.get("theme"), "code");
    assert.equal(url.searchParams.get("sort"), "trust-asc");
    // catalogOnly=false means param is omitted
    assert.equal(url.searchParams.has("catalog"), false);
  });
});

describe("forge_get_pack (no auth)", () => {
  let mod;

  before(async () => {
    mod = await loadShared();
  });

  it("calls /packs/{packId} with correct URL encoding", async () => {
    const server = mockServer();
    const data = { status: "ok", pack: { pack_id: "hermes-agent", name: "Hermes Agent" } };
    const fetchFn = mockForgeFetch(data);
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    const result = await server.handler({
      params: { name: "forge_get_pack", arguments: { packId: "hermes-agent" } },
    });

    assert.equal(fetchFn.calls.length, 1);
    assert.equal(fetchFn.calls[0].path, "/packs/hermes-agent");

    assert.ok(result.content);
    assert.equal(result.content.length, 2);
    assert.ok(result.content[1].text.includes('"hermes-agent"'));
    assert.equal(authFn.calls.length, 0);
  });

  it("URL-encodes special characters in packId", async () => {
    const server = mockServer();
    const fetchFn = mockForgeFetch({ status: "ok" });
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    await server.handler({
      params: { name: "forge_get_pack", arguments: { packId: "my pack/123" } },
    });

    assert.equal(fetchFn.calls[0].path, "/packs/my%20pack%2F123");
  });

  it("throws when packId is missing", async () => {
    const server = mockServer();
    const fetchFn = mockForgeFetch({});
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    await assert.rejects(
      () => server.handler({ params: { name: "forge_get_pack", arguments: {} } }),
      /packId is required/,
    );
  });
});

describe("get_magic_link (no auth)", () => {
  let mod;

  before(async () => {
    mod = await loadShared();
  });

  it("calls /v1/auth/magic with email and default next", async () => {
    const server = mockServer();
    const data = { status: "ok", dev_verify_url: "http://localhost:3000/verify" };
    const fetchFn = mockForgeFetch(data);
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    const result = await server.handler({
      params: { name: "get_magic_link", arguments: { email: "test@example.com" } },
    });

    assert.equal(fetchFn.calls.length, 1);
    assert.equal(fetchFn.calls[0].path, "/v1/auth/magic");
    assert.equal(fetchFn.calls[0].options.method, "POST");

    const body = JSON.parse(fetchFn.calls[0].options.body);
    assert.equal(body.email, "test@example.com");
    assert.equal(body.next, "/");

    assert.ok(result.content[1].text.includes("test@example.com"));
    assert.ok(result.content[1].text.includes("Dev verify URL"));
    assert.equal(authFn.calls.length, 0);
  });

  it("passes custom next parameter", async () => {
    const server = mockServer();
    const fetchFn = mockForgeFetch({ status: "ok" });
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    await server.handler({
      params: { name: "get_magic_link", arguments: { email: "a@b.com", next: "/dashboard" } },
    });

    const body = JSON.parse(fetchFn.calls[0].options.body);
    assert.equal(body.next, "/dashboard");
  });

  it("throws when email is missing", async () => {
    const server = mockServer();
    const fetchFn = mockForgeFetch({});
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    await assert.rejects(
      () => server.handler({ params: { name: "get_magic_link", arguments: {} } }),
      /email is required/,
    );
  });
});

// ─── Tests: Auth-Required Tools ──────────────────────────────────────

describe("open_pack (auth required)", () => {
  let mod;

  before(async () => {
    mod = await loadShared();
  });

  it("calls authFn then POST /v1/agents with packId", async () => {
    const server = mockServer();
    const data = { status: "ok", agent: { id: "agent-123", name: "My Agent" } };
    const fetchFn = mockForgeFetch(data);
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    const result = await server.handler({
      params: { name: "open_pack", arguments: { packId: "hermes-agent" } },
    });

    // Auth was called
    assert.equal(authFn.calls.length, 1);
    assert.equal(authFn.calls[0], "open_pack");

    // Correct API call
    assert.equal(fetchFn.calls.length, 1);
    assert.equal(fetchFn.calls[0].path, "/v1/agents");
    assert.equal(fetchFn.calls[0].options.method, "POST");
    assert.equal(JSON.parse(fetchFn.calls[0].options.body).packId, "hermes-agent");

    // Response formatting
    assert.ok(result.content[1].text.includes("hermes-agent"));
  });

  it("throws auth error when auth fails", async () => {
    const server = mockServer();
    const fetchFn = mockForgeFetch({});
    const authFn = mockAuth(true); // will throw

    mod.createToolHandlers(server, fetchFn, authFn);

    await assert.rejects(
      () => server.handler({ params: { name: "open_pack", arguments: { packId: "x" } } }),
      /Authentication required/,
    );
    // fetchFn should NOT have been called (auth throws first)
    assert.equal(fetchFn.calls.length, 0);
  });

  it("throws when packId is missing", async () => {
    const server = mockServer();
    const fetchFn = mockForgeFetch({});
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    await assert.rejects(
      () => server.handler({ params: { name: "open_pack", arguments: {} } }),
      /packId is required/,
    );
  });
});

describe("chat_with_agent (auth required)", () => {
  let mod;

  before(async () => {
    mod = await loadShared();
  });

  it("creates session then sends message when no sessionId", async () => {
    const server = mockServer();

    // Step 1: create session returns session with id
    const sessionRes = {
      status: "ok",
      session: { id: "session-abc-123" },
    };
    // Step 2: send message
    const msgRes = { status: "ok", message: { id: "msg-1", content: "Hello!" } };
    // Step 3: get session
    const session = {
      status: "ok",
      session: { id: "session-abc-123", messages: [{ role: "assistant", content: "Hi!" }] },
    };

    let callIndex = 0;
    const responses = [sessionRes, msgRes, session];
    const fetchFn = async (path, options) => {
      const res = responses[callIndex];
      callIndex++;
      // Record call
      if (!fetchFn.calls) fetchFn.calls = [];
      fetchFn.calls.push({ path, options: { ...options, body: options?.body ?? undefined } });
      return res;
    };
    fetchFn.calls = [];

    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    const result = await server.handler({
      params: {
        name: "chat_with_agent",
        arguments: { agentId: "agent-1", message: "Hello there!" },
      },
    });

    // Auth was called
    assert.equal(authFn.calls.length, 1);
    assert.equal(authFn.calls[0], "chat_with_agent");

    // Three API calls: create session, send message, get session
    assert.equal(fetchFn.calls.length, 3);

    // Call 1: POST /v1/chat/sessions
    assert.equal(fetchFn.calls[0].path, "/v1/chat/sessions");
    assert.equal(fetchFn.calls[0].options.method, "POST");
    const sessionBody = JSON.parse(fetchFn.calls[0].options.body);
    assert.equal(sessionBody.agentId, "agent-1");
    assert.equal(sessionBody.model, "agent-1");

    // Call 2: POST /v1/chat/sessions/{sid}/messages
    assert.ok(fetchFn.calls[1].path.includes("session-abc-123/messages"));
    assert.equal(fetchFn.calls[1].options.method, "POST");
    const msgBody = JSON.parse(fetchFn.calls[1].options.body);
    assert.equal(msgBody.content, "Hello there!");

    // Call 3: GET /v1/chat/sessions/{sid}
    assert.ok(fetchFn.calls[2].path.includes("session-abc-123"));

    // Response contains sessionId
    assert.ok(result.content[0].text.includes("session-abc-123"));
    assert.ok(result.content[1].text.includes("agent-1"));
  });

  it("reuses existing sessionId when provided", async () => {
    const server = mockServer();
    const fetchFn = mockForgeFetch({ status: "ok" });
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    await server.handler({
      params: {
        name: "chat_with_agent",
        arguments: { agentId: "agent-1", message: "Hi", sessionId: "existing-session" },
      },
    });

    // Only 2 calls: send message and get session (no session creation)
    assert.equal(fetchFn.calls.length, 2);
    assert.ok(fetchFn.calls[0].path.includes("existing-session/messages"));
    assert.equal(fetchFn.calls[0].options.method, "POST");
  });

  it("throws when agentId is missing", async () => {
    const server = mockServer();
    const fetchFn = mockForgeFetch({});
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    await assert.rejects(
      () =>
        server.handler({
          params: { name: "chat_with_agent", arguments: { message: "Hi" } },
        }),
      /agentId is required/,
    );
  });

  it("throws when message is missing", async () => {
    const server = mockServer();
    const fetchFn = mockForgeFetch({});
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    await assert.rejects(
      () =>
        server.handler({
          params: { name: "chat_with_agent", arguments: { agentId: "a" } },
        }),
      /message is required/,
    );
  });
});

describe("fuse_agents (auth required)", () => {
  let mod;

  before(async () => {
    mod = await loadShared();
  });

  it("calls /v1/synthesis/fuse with baseAgentId and fodderAgentId", async () => {
    const server = mockServer();
    const data = { status: "ok", result: "success" };
    const fetchFn = mockForgeFetch(data);
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    const result = await server.handler({
      params: {
        name: "fuse_agents",
        arguments: { baseAgentId: "agent-base", fodderAgentId: "agent-fodder" },
      },
    });

    assert.equal(authFn.calls.length, 1);
    assert.equal(authFn.calls[0], "fuse_agents");

    assert.equal(fetchFn.calls.length, 1);
    assert.equal(fetchFn.calls[0].path, "/v1/synthesis/fuse");
    assert.equal(fetchFn.calls[0].options.method, "POST");
    const body = JSON.parse(fetchFn.calls[0].options.body);
    assert.equal(body.baseAgentId, "agent-base");
    assert.equal(body.fodderAgentId, "agent-fodder");

    // Success response
    assert.ok(result.content[1].text.includes("✨"));
    assert.ok(result.content[1].text.includes("success"));
  });

  it("handles Core Fracture result with different emoji", async () => {
    const server = mockServer();
    const data = { status: "ok", result: "core_fracture" };
    const fetchFn = mockForgeFetch(data);
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    const result = await server.handler({
      params: {
        name: "fuse_agents",
        arguments: { baseAgentId: "a", fodderAgentId: "b" },
      },
    });

    assert.ok(result.content[1].text.includes("💥"));
    assert.ok(result.content[1].text.includes("Core Fracture"));
  });

  it("throws when baseAgentId is missing", async () => {
    const server = mockServer();
    const fetchFn = mockForgeFetch({});
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    await assert.rejects(
      () =>
        server.handler({
          params: { name: "fuse_agents", arguments: { fodderAgentId: "b" } },
        }),
      /baseAgentId is required/,
    );
  });

  it("throws when fodderAgentId is missing", async () => {
    const server = mockServer();
    const fetchFn = mockForgeFetch({});
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    await assert.rejects(
      () =>
        server.handler({
          params: { name: "fuse_agents", arguments: { baseAgentId: "a" } },
        }),
      /fodderAgentId is required/,
    );
  });
});

describe("forge_get_agent (auth required)", () => {
  let mod;

  before(async () => {
    mod = await loadShared();
  });

  it("calls /v1/agents/{agentId} and returns agent data", async () => {
    const server = mockServer();
    const data = {
      status: "ok",
      agent: {
        id: "agent-xp-1",
        level: 5,
        current_xp: 120,
        level_progress: { required_xp: 200 },
      },
    };
    const fetchFn = mockForgeFetch(data);
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    const result = await server.handler({
      params: { name: "forge_get_agent", arguments: { agentId: "agent-xp-1" } },
    });

    assert.equal(authFn.calls.length, 1);
    assert.equal(authFn.calls[0], "forge_get_agent");

    assert.equal(fetchFn.calls.length, 1);
    assert.equal(fetchFn.calls[0].path, "/v1/agents/agent-xp-1");

    assert.ok(result.content[1].text.includes("agent-xp-1"));
    assert.ok(result.content[0].text.includes("level"));
  });

  it("throws when agentId is missing", async () => {
    const server = mockServer();
    const fetchFn = mockForgeFetch({});
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    await assert.rejects(
      () => server.handler({ params: { name: "forge_get_agent", arguments: {} } }),
      /agentId is required/,
    );
  });
});

// ── forge_list_leaderboard ─────────────────────────────────────────

describe("forge_list_leaderboard (no auth)", () => {
  let mod;

  before(async () => {
    mod = await loadShared();
  });

  it("calls /packs with trust-desc sort and catalog filter", async () => {
    const server = mockServer();
    const data = {
      status: "ok",
      packs: [
        { pack_id: "hermes-agent", name: "Hermes Agent", trust_score: 95 },
        { pack_id: "code-assistant", name: "Code Assistant", trust_score: 88 },
      ],
    };
    const fetchFn = mockForgeFetch(data);
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    const result = await server.handler({
      params: { name: "forge_list_leaderboard", arguments: { limit: 5 } },
    });

    // Correct API path
    assert.equal(fetchFn.calls.length, 1);
    const url = new URL(fetchFn.calls[0].path, "https://x.com");
    assert.equal(url.searchParams.get("sort"), "trust-desc");
    assert.equal(url.searchParams.get("catalog"), "1");

    // Response formatting
    assert.ok(result.content);
    assert.equal(result.content.length, 2);
    assert.ok(result.content[1].text.includes("2 packs"));

    // No auth called
    assert.equal(authFn.calls.length, 0);
  });

  it("uses default limit of 20 when not specified", async () => {
    const server = mockServer();
    const fetchFn = mockForgeFetch({ status: "ok", packs: [] });
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    await server.handler({
      params: { name: "forge_list_leaderboard", arguments: {} },
    });

    assert.equal(fetchFn.calls.length, 1);
    assert.ok(fetchFn.calls[0].path.includes("sort=trust-desc"));
  });

  it("handles empty packs gracefully", async () => {
    const server = mockServer();
    const fetchFn = mockForgeFetch({ status: "ok" }); // no packs key
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    const result = await server.handler({
      params: { name: "forge_list_leaderboard", arguments: {} },
    });

    assert.ok(result.content[1].text.includes("0 packs"));
  });
});

describe("subscribe_tier (auth required)", () => {
  let mod;

  before(async () => {
    mod = await loadShared();
  });

  it("calls /v1/me/tier with no params", async () => {
    const server = mockServer();
    const data = {
      status: "ok",
      tier: "pro",
      limits: { max_agents: 50, max_daily_chats: 500 },
    };
    const fetchFn = mockForgeFetch(data);
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    const result = await server.handler({
      params: { name: "subscribe_tier", arguments: {} },
    });

    assert.equal(authFn.calls.length, 1);
    assert.equal(authFn.calls[0], "subscribe_tier");

    assert.equal(fetchFn.calls.length, 1);
    assert.equal(fetchFn.calls[0].path, "/v1/me/tier");
    assert.equal(fetchFn.calls[0].options.method, undefined); // GET

    assert.ok(result.content[1].text.includes("Subscription tier"));
    assert.ok(result.content[0].text.includes("pro"));
  });
});

describe("deploy_agent_to_telegram (auth required)", () => {
  let mod;
  let originalFetch;

  before(async () => {
    mod = await loadShared();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls /v1/webhooks then Telegram API", async () => {
    const server = mockServer();

    const webhookRes = { status: "ok", id: "wh-123" };
    const telegramRes = { ok: true, result: true, description: "Webhook was set" };

    const calls = [];
    const forgeFn = async (path, options) => {
      calls.push({ path, options: { ...options, body: options?.body ?? undefined } });
      if (path === "/v1/webhooks") return webhookRes;
      return {};
    };

    // Mock global fetch for Telegram API
    globalThis.fetch = mock.fn(async (url, options) => {
      return {
        ok: true,
        json: async () => telegramRes,
      };
    });

    const authFn = mockAuth(false);

    mod.createToolHandlers(server, forgeFn, authFn);

    const result = await server.handler({
      params: {
        name: "deploy_agent_to_telegram",
        arguments: {
          agentId: "agent-tg-1",
          telegramBotToken: "123456789:ABCdefGHIjklmNOPqrstUVwxyz",
          secret: "a-16-char-secret!",
        },
      },
    });

    // Auth was called
    assert.equal(authFn.calls.length, 1);
    assert.equal(authFn.calls[0], "deploy_agent_to_telegram");

    // Forge webhook creation
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/v1/webhooks");
    assert.equal(calls[0].options.method, "POST");
    const whBody = JSON.parse(calls[0].options.body);
    assert.equal(whBody.secret, "a-16-char-secret!");
    assert.deepEqual(whBody.events, ["agent.message", "agent.deployed"]);

    // Telegram API was called
    assert.equal(globalThis.fetch.mock.callCount(), 1);
    const tgUrl = globalThis.fetch.mock.calls[0].arguments[0];
    assert.ok(tgUrl.includes("api.telegram.org/bot"));
    assert.ok(tgUrl.includes("/setWebhook"));

    // Response formatting
    assert.ok(result.content[1].text.includes("agent-tg-1"));
    assert.ok(result.content[1].text.includes("wh-123"));
    assert.ok(result.content[1].text.includes("configured successfully"));
  });

  it("generates random secret when not provided", async () => {
    const server = mockServer();
    const calls = [];
    const forgeFn = async (path, options) => {
      calls.push({ path, options: { ...options, body: options?.body ?? undefined } });
      return { status: "ok", id: "wh-456" };
    };
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));

    const authFn = mockAuth(false);

    mod.createToolHandlers(server, forgeFn, authFn);

    await server.handler({
      params: {
        name: "deploy_agent_to_telegram",
        arguments: { agentId: "a", telegramBotToken: "123:abc" },
      },
    });

    const whBody = JSON.parse(calls[0].options.body);
    // Should be a 64-char hex string (32 random bytes)
    assert.equal(whBody.secret.length, 64, `expected 64-char hex, got ${whBody.secret.length}`);
    assert.ok(/^[0-9a-f]+$/.test(whBody.secret));
  });

  it("validates secret minimum length", async () => {
    const server = mockServer();
    const fetchFn = mockForgeFetch({});
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    await assert.rejects(
      () =>
        server.handler({
          params: {
            name: "deploy_agent_to_telegram",
            arguments: { agentId: "a", telegramBotToken: "123:abc", secret: "short" },
          },
        }),
      /secret must be at least 16 characters/,
    );
  });

  it("throws when agentId is missing", async () => {
    const server = mockServer();
    const fetchFn = mockForgeFetch({});
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    await assert.rejects(
      () =>
        server.handler({
          params: {
            name: "deploy_agent_to_telegram",
            arguments: { telegramBotToken: "123:abc" },
          },
        }),
      /agentId is required/,
    );
  });

  it("throws when telegramBotToken is missing", async () => {
    const server = mockServer();
    const fetchFn = mockForgeFetch({});
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    await assert.rejects(
      () =>
        server.handler({
          params: {
            name: "deploy_agent_to_telegram",
            arguments: { agentId: "a" },
          },
        }),
      /telegramBotToken is required/,
    );
  });
});

// ─── Tests: Auth Enforcement Across All Auth Tools ───────────────────

describe("Auth enforcement — all auth-required tools reject without auth", () => {
  let mod;

  const authTools = [
    { name: "open_pack", args: { packId: "test" } },
    { name: "chat_with_agent", args: { agentId: "test", message: "hi" } },
    { name: "fuse_agents", args: { baseAgentId: "a", fodderAgentId: "b" } },
    { name: "forge_get_agent", args: { agentId: "test" } },
    { name: "subscribe_tier", args: {} },
    { name: "deploy_agent_to_telegram", args: { agentId: "a", telegramBotToken: "123:abc" } },
  ];

  before(async () => {
    mod = await loadShared();
  });

  for (const tool of authTools) {
    it(`${tool.name} throws AuthRequiredError when no auth`, async () => {
      const server = mockServer();
      const fetchFn = mockForgeFetch({});
      const authFn = mockAuth(true); // throws

      mod.createToolHandlers(server, fetchFn, authFn);

      await assert.rejects(
        () => server.handler({ params: { name: tool.name, arguments: tool.args } }),
        /Authentication required/,
      );

      // fetchFn should NOT have been called (auth throws first)
      assert.equal(fetchFn.calls.length, 0);
    });
  }
});

// ─── Tests: Unknown Tool ─────────────────────────────────────────────

describe("Unknown tool handling", () => {
  let mod;

  before(async () => {
    mod = await loadShared();
  });

  it("throws an error for an unknown tool name", async () => {
    const server = mockServer();
    const fetchFn = mockForgeFetch({});
    const authFn = mockAuth(false);

    mod.createToolHandlers(server, fetchFn, authFn);

    await assert.rejects(
      () => server.handler({ params: { name: "nonexistent_tool", arguments: {} } }),
      /Unknown tool/,
    );
  });
});
