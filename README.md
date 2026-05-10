# Forge MCP

[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Forge MCP** is a [Model Context Protocol](https://modelcontextprotocol.io) server that bridges AI assistants to the **Hermes Forge** AI Agent Platform.

With Forge MCP, any MCP-compatible client (Claude Desktop, Cursor, Windsurf, etc.) can:

- **Discover** Agent Packs from the Forge catalog
- **Open** new agents from packs
- **Chat** with agents in sessions
- **Fuse** agents together (Synthesis / Core Fracture)
- **Track** XP, levels, and subscription tier
- **Deploy** agents to Telegram
- **Authenticate** via magic link

---

## Quick Start

### Git clone distribution (recommended)

```bash
git clone https://github.com/JonasAbde/hermes-forge-mcp.git
cd hermes-forge-mcp
npm install   # also runs build via prepare script
```

### npm (future — not yet published)

Once published to npm:

```bash
npm install forge-mcp
npx forge-mcp
```

Generate your PAT at [forge.tekup.dk/account](https://forge.tekup.dk/account).

### Verify it works

```bash
# List available packs (public — no auth required)
echo '{"jsonrpc":"2.0","id":1,"method":"resources/list"}' | node build/index.js
```

---

## Features

### Resources

Read-only endpoints that return structured data from the Forge API.

| URI | Auth | Description |
|-----|------|-------------|
| `forge://packs` | No | List all Agent Packs in the catalog |
| `forge://agents` | Yes | List your collected agents with XP, level, and stats |
| `forge://user/profile` | Yes | Get your user profile |

### Tools

| Tool | Auth | Description |
|------|------|-------------|
| `open_pack` | Yes | Open/reveal a new agent from a pack |
| `chat_with_agent` | Yes | Send a message to an agent (+25 XP per message) |
| `fuse_agents` | Yes | Fuse two agents (85% success / 15% Core Fracture) |
| `get_xp` | Yes | Get XP, level, and level progress for an agent |
| `subscribe_tier` | Yes | Get subscription tier and usage limits |
| `deploy_agent_to_telegram` | Yes | Deploy an agent to Telegram via webhook |
| `get_magic_link` | No | Request a magic link for email-based authentication |

**⚠️ Important:** All mutation tools (`open_pack`, `chat_with_agent`, `fuse_agents`, `get_xp`, `subscribe_tier`, `deploy_agent_to_telegram`) and authenticated resources (`forge://agents`, `forge://user/profile`) require `FORGE_PAT` or `FORGE_API_KEY`. If unauthenticated, they will return a clear error with setup instructions.

### Prompts

| Prompt | Description |
|--------|-------------|
| `agent_card` | Format an agent card overview (stats, level, XP, rarity, fusions) |
| `pack_summary` | Summarize an Agent Pack (description, capabilities, metrics) |
| `fusion_guide` | Guide explaining agent fusion mechanics with optional agent projections |

---

## API Endpoints

Forge MCP proxies the following Hermes Forge API endpoints:

| MCP Tool/Resource | Forge API Endpoint | Status |
|-------------------|-------------------|--------|
| `forge://packs` | `GET /api/forge/packs` | ✅ Live |
| `forge://packs/{packId}` | `GET /api/forge/packs/{packId}` | ✅ Live |
| `forge://agents` | `GET /api/forge/v1/agents` | ✅ Live |
| `forge://user/profile` | `GET /api/forge/v1/me` | ✅ Live |
| `open_pack` | `POST /api/forge/v1/agents` | ✅ Live |
| `chat_with_agent` (create) | `POST /api/forge/v1/chat/sessions` | ✅ Live |
| `chat_with_agent` (message) | `POST /api/forge/v1/chat/sessions/{id}/messages` | ✅ Live |
| `chat_with_agent` (get) | `GET /api/forge/v1/chat/sessions/{id}` | ✅ Live |
| `fuse_agents` | `POST /api/forge/v1/synthesis/fuse` | ✅ Live |
| `get_xp` | `GET /api/forge/v1/agents/{id}` | ✅ Live |
| `subscribe_tier` | `GET /api/forge/v1/me/tier` | ✅ Live |
| `deploy_agent_to_telegram` | `POST /api/forge/v1/webhooks` + Telegram API | ✅ Live |
| `get_magic_link` | `POST /api/forge/v1/auth/magic` | ✅ Live |

All endpoints are verified against the live Forge API at `forge.tekup.dk`. If any endpoint returns unexpected data, the error response will be sanitized (tokens masked) and include actionable information.

---

## Configuration

### Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `FORGE_API_BASE_URL` | No | `https://forge.tekup.dk/api/forge` | Forge API base URL |
| `FORGE_PAT` | One of | — | Personal Access Token |
| `FORGE_API_KEY` | One of | — | API Key |
| `FORGE_EMAIL` | No | — | Email for magic link auth |
| `FORGE_EXTRA_HEADERS` | No | — | Extra JSON headers (advanced) |

### MCP Client Configuration

#### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "forge-mcp": {
      "command": "node",
      "args": ["/path/to/hermes-forge-mcp/build/index.js"],
      "env": {
        "FORGE_API_BASE_URL": "https://forge.tekup.dk/api/forge",
        "FORGE_PAT": "hfp_your_pat_here"
      }
    }
  }
}
```

#### Cursor

In Cursor settings → Features → MCP Servers:

```
Name: forge-mcp
Type: command
Command: node /path/to/hermes-forge-mcp/build/index.js
Environment: FORGE_PAT=hfp_your_pat_here FORGE_API_BASE_URL=https://forge.tekup.dk/api/forge
```

Or add to your `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "forge-mcp": {
      "command": "node",
      "args": ["/path/to/hermes-forge-mcp/build/index.js"],
      "env": {
        "FORGE_API_BASE_URL": "https://forge.tekup.dk/api/forge",
        "FORGE_PAT": "hfp_your_pat_here"
      }
    }
  }
}
```

#### Windsurf

In Windsurf settings → MCP Servers, add:

```
Command: node /path/to/hermes-forge-mcp/build/index.js
Environment: FORGE_PAT=hfp_your_pat_here
```

#### MCP Inspector

```bash
# Quick inspection of resources/tools/prompts
npm run inspect
```

Or with explicit env:

```bash
FORGE_API_BASE_URL=https://forge.tekup.dk/api/forge \
FORGE_PAT=hfp_your_pat_here \
npx @modelcontextprotocol/inspector node build/index.js
```

---

## Architecture

```
MCP Client (Claude Desktop, Cursor, Windsurf, etc.)
       │
       ▼
Forge MCP Server (stdio transport — build/index.js)
       │
       ▼
Forge REST API (forge.tekup.dk/api/forge)
       │
       ▼
SQLite (forge.db) + Agent Pack Catalog
```

- **Resources** map to read-only API calls (`GET /packs`, `GET /v1/agents`, `GET /v1/me`)
- **Tools** map to mutation API calls (`POST /v1/agents`, `POST /v1/chat/sessions`, etc.)
- **Prompts** are template-based, fetching live data from the API and formatting it

---

## Security

### Authentication

All mutation tools require authentication. If you call a tool without credentials, you'll receive:

```
Authentication required for "open_pack".

Set one of:
  - FORGE_PAT=hfp_xxx  (Personal Access Token from forge.tekup.dk/account)
  - FORGE_API_KEY=xxx  (API Key from forge.tekup.dk/account)

Pass these as environment variables in your MCP client config.
```

### Token Safety

- **Tokens are never logged.** The server masks PATs, API keys, and Telegram bot tokens in all:
  - Startup messages (`Token: hfp_xxxx...abcd`)
  - Error responses (leaked tokens are regex-detected and masked)
  - Tool responses (`deploy_agent_to_telegram` returns only a masked token preview)
- **PATs and API keys live in environment variables only** — never in code, config files, or logs.
- **The `forge.env` file is gitignored** — never commit your tokens to version control.

### Safety Guidelines

| Area | Guideline |
|------|-----------|
| PAT/API Key | Store in env vars or your MCP client's secure env config |
| Telegram tokens | Never share. Only used for the `setWebhook` API call |
| `deploy_agent_to_telegram` | Creates a live webhook — verify the target agent first |
| `fuse_agents` | Destroys the fodder agent — this is irreversible |
| Forking | The repo is MIT licensed — fork responsibly |

---

## Troubleshooting

### "Authentication required" on mutation tools
→ You need `FORGE_PAT` or `FORGE_API_KEY` set in your environment. Generate one at [forge.tekup.dk/account](https://forge.tekup.dk/account).

### "Cannot find module" errors
→ Run `npm install` then `npm run build`.

### "Failed to fetch" / "fetch is not defined"
→ Forge MCP requires Node.js 18+ (the `fetch` API is built-in). Check `node --version`.

### "resources/list" returns nothing
→ Ensure `npm run build` completed successfully. The server communicates over stdin/stdout — use `echo '{"jsonrpc":"2.0","id":1,"method":"resources/list"}' | node build/index.js` to test.

### "Forge API error" messages
→ Your token may be invalid or expired. Regenerate at [forge.tekup.dk/account](https://forge.tekup.dk/account). Or the API may be down — check `FORGE_API_BASE_URL` is correct.

### MCP Inspector shows no tools
→ Make sure you're passing environment variables. Run:
```bash
FORGE_PAT=hfp_xxx npx @modelcontextprotocol/inspector node build/index.js
```

---

## Development

```bash
# Install dependencies
npm install

# Watch mode (with hot reload via tsx)
npm run dev

# Build TypeScript
npm run build

# Run tests (Node.js native test runner)
npm test

# Smoke test (stdio — no real API calls)
npm run smoke

# Launch MCP Inspector
npm run inspect
```

### Project Structure

```
hermes-forge-mcp/
├── src/
│   └── index.ts          # MCP server source
├── build/                 # Compiled output (gitignored)
├── tests/
│   ├── smoke.mjs          # stdio smoke test (no API calls)
│   └── test-*.mjs         # Unit tests (Node.js test runner)
├── examples/
│   └── usage.mjs          # Example usage script
├── .env.example           # Config template
├── package.json
└── tsconfig.json
```

---

## Release Checklist

Before tagging a public release:

- [ ] `npm test` passes (unit tests + schema checks)
- [ ] `npm run build` succeeds cleanly
- [ ] `npm run smoke` passes (stdio contract verification)
- [ ] All mutation tools require auth (verified)
- [ ] Tokens masked in logs, errors, and responses (audited)
- [ ] README is current (resources, tools, prompts, endpoints)
- [ ] MCP Inspector shows all resources/tools/prompts
- [ ] Claude Desktop config verified
- [ ] `forge.env` not tracked in git
- [ ] Version bumped in `package.json`
- [ ] License file present
- [ ] GitHub release drafted with changelog

---

## Relationship to forge-mcp-registry (monorepo)

The `JonasAbde/hermes-forge-platform` monorepo contains a **Python MCP server** at `integrations/mcp-forge-registry/` that served as the original reference implementation for Forge catalog access.

| Aspect | Forge MCP (this repo) | forge-mcp-registry (monorepo) |
|--------|----------------------|------------------------------|
| **Purpose** | Full platform API — read + write | Read-only catalog registry |
| **Language** | TypeScript | Python |
| **Auth** | PAT, API Key, Magic Link | Optional Bearer token |
| **Tools** | 7 (incl. chat, fuse, deploy) | 3 (list, get, resolve) |
| **Resources** | 3 (packs, agents, profile) | None |
| **Prompts** | 3 (agent_card, pack_summary, fusion_guide) | None |
| **Status** | **Active development** — source of truth | Legacy / reference |

**This repo (`JonasAbde/hermes-forge-mcp`) is the source of truth for Forge MCP.** The Python MCP in the monorepo is maintained as a legacy read-only registry integration.

### Ported from Python MCP

The following components were ported from `integrations/mcp-forge-registry/`:

| Component | Source | Purpose |
|-----------|--------|---------|
| Response shape validation | `api_resilience.py` | Validates API response against `{status, pack, metrics}` contract |
| Exponential backoff retry | `api_resilience.py` | Auto-retries transient failures with 100ms → 200ms → 400ms backoff |
| Health tracking | `api_resilience.py` | Monitors API error rates and validation warnings |
| Test patterns | `tests/test_api_resilience.py` | Mocked unit tests with controlled API responses |

See [`src/resilience.ts`](src/resilience.ts) for the ported implementation.

### What was NOT ported

| Component | Reason |
|-----------|--------|
| Prometheus metrics (`metrics.py`) | Valuable but out of scope for v1 — planned for future release |
| Hardcoded bundle fallback (`bundles_data.py`) | Platform-specific game data, not appropriate for MCP server |
| Python packaging (`pyproject.toml`) | Language-specific — this is a TypeScript/Node.js project |
| Monorepo CI/config | Belongs in the monorepo, not in this standalone repo |

---

## License

MIT — see [LICENSE](LICENSE).

---

## Resources

- [Model Context Protocol](https://modelcontextprotocol.io)
- [Hermes Forge Platform](https://forge.tekup.dk)
- [Hermes Agent](https://hermes-agent.nousresearch.com)
- [Issue Tracker](https://github.com/JonasAbde/hermes-forge-mcp/issues)
