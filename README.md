<p align="center"><img src=".github/forge-wordmark.svg" alt="Hermes Forge" width="400"/></p>

# Forge MCP

[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blue)](https://modelcontextprotocol.io)
[![CI](https://github.com/JonasAbde/hermes-forge-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/JonasAbde/hermes-forge-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/forge-mcp?color=blue&logo=npm)](https://www.npmjs.com/package/forge-mcp)

**Forge MCP** is a [Model Context Protocol](https://modelcontextprotocol.io) server that bridges AI assistants to the **Hermes Forge** AI Agent Platform.

With Forge MCP, any MCP-compatible client (Claude Desktop, Cursor, Windsurf, etc.) can:

- **Discover** Agent Packs from the Forge catalog
- **Open** new agents from packs
- **Chat** with agents in sessions (+25 XP per message)
- **Fuse** agents together (Synthesis / Core Fracture)
- **Track** XP, levels, and subscription tier
- **Deploy** agents to Telegram
- **Authenticate** via magic link

---

## Quick Start

### Install from npm (global CLI)

```bash
npm install -g forge-mcp
```

### Git clone (development)

```bash
git clone https://github.com/JonasAbde/hermes-forge-mcp.git
cd hermes-forge-mcp
npm install   # also runs build via prepare script
```

Generate your PAT at [forge.tekup.dk/account](https://forge.tekup.dk/account).

### Verify it works

**Stdio (local):**

```bash
# List available packs (public — no auth required)
echo '{"jsonrpc":"2.0","id":1,"method":"resources/list"}' | node build/index.js
```

**HTTP (remote/VPS):**

```bash
# Health check
curl http://localhost:8641/health

# List available tools
curl http://localhost:8641/health/tools
```

---

## Production Deployment (VPS)

The MCP server runs as a **systemd service** with auto-restart on failure and boot. See [`DEPLOY.md`](DEPLOY.md) for the full runbook.

```bash
# Service status
sudo systemctl status forge-mcp.service

# Restart after update
sudo systemctl restart forge-mcp.service

# Logs
sudo journalctl -u forge-mcp.service -f
```

The HTTP server runs on port **8641** by default and exposes:
- `GET /health` — Server + auth + API health status
- `GET /health/tools` — Registered tools metadata
- `POST /mcp` — MCP protocol endpoint (SSE-based HTTP transport)

---

## Features

### Resources

Read-only endpoints that return structured data from the Forge API.

| URI | Auth | Description |
|-----|------|-------------|
| `forge://packs` | No | List all Agent Packs in the catalog |
| `forge://agents` | Yes | List your collected agents with XP, level, and stats |
| `forge://user/profile` | Yes | Get your user profile (full DTO) |

### Tools

| Tool | Auth | Description |
|------|------|-------------|
| `forge_list_packs` | No | List Agent Packs with filter, sort, and theme options |
| `forge_get_pack` | No | Get full details for a single Agent Pack by ID |
| `open_pack` | Yes | Open/reveal a new agent from a pack |
| `chat_with_agent` | Yes | Send a message to an agent (+25 XP per message) |
| `fuse_agents` | Yes | Fuse two agents (85% success / 15% Core Fracture) |
| `get_xp` | Yes | Get XP, level, and level progress for an agent |
| `subscribe_tier` | Yes | Get subscription tier and usage limits |
| `deploy_agent_to_telegram` | Yes | Deploy an agent to Telegram via webhook |
| `get_magic_link` | No | Request a magic link for email-based authentication |

**Total: 9 tools.** All mutation tools and authenticated resources require `FORGE_PAT` or `FORGE_API_KEY`. Read-only tools (`forge_list_packs`, `forge_get_pack`, `get_magic_link`) work without auth.

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
| `forge://user/profile` | `GET /api/forge/v1/me/profile` | ✅ Live |
| `forge_list_packs` | `GET /api/forge/packs?catalog&sort&q&theme` | ✅ Live |
| `forge_get_pack` | `GET /api/forge/packs/{packId}` | ✅ Live |
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
| `MCP_HTTP_PORT` | No | `8641` | HTTP server listen port (production) |

### MCP Client Configuration

All client configs use `stdio` transport via `build/index.js`. For remote MCP access, point clients to the HTTP endpoint at `http://host:8641`.

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

```
Name: forge-mcp
Type: command
Command: node /path/to/hermes-forge-mcp/build/index.js
Environment: FORGE_PAT=hfp_your_pat_here FORGE_API_BASE_URL=https://forge.tekup.dk/api/forge
```

#### Hermes Agent

Configure in `.hermes/config.yaml`:

```yaml
mcp_servers:
  forge-mcp:
    command: "node"
    args: ["/path/to/hermes-forge-mcp/build/http-server.js"]
    env:
      FORGE_API_BASE_URL: "https://forge.tekup.dk/api/forge"
      FORGE_PAT: "hfp_your_pat_here"
```

---

## Architecture

```
MCP Client (Claude Desktop, Cursor, Hermes Agent)
       |
       v
Forge MCP Server (HTTP @ :8641 or stdio)
       |
       v
Forge REST API (forge.tekup.dk/api/forge)
       |
       v
SQLite (forge.db) + Agent Pack Catalog
```

**Transport modes:**
- **Stdio** (`build/index.js`) — local clients (Claude Desktop, Cursor)
- **HTTP** (`build/http-server.js`, port 8641) — remote/VPS deployment, health endpoints

**Design principles:**
- **Resources** map to read-only API calls (`GET /packs`, `GET /v1/agents`, `GET /v1/me/profile`)
- **Tools** map to mutation API calls (`POST /v1/agents`, `POST /v1/chat/sessions`, etc.)
- **Prompts** are template-based, fetching live data from the API and formatting it
- **No own database** — all data fetched live from the Forge Platform API
- **No catalog copy** — the platform is the single source of truth

---

## Security

### Authentication

All mutation tools require authentication. If you call a tool without credentials, you'll receive a clear error with setup instructions.

### Token Safety

- **Tokens are never logged.** The server masks PATs, API keys, and Telegram bot tokens in all startup messages, error responses, and tool output.
- **PATs and API keys live in environment variables only** — never in code, config files, or logs.
- **The `forge.env` file is gitignored** — never commit your tokens to version control.

### Safety Guidelines

| Area | Guideline |
|------|-----------|
| PAT/API Key | Store in env vars or your MCP client's secure env config |
| Telegram tokens | Never share. Only used for the `setWebhook` API call |
| `deploy_agent_to_telegram` | Creates a live webhook — verify the target agent first |
| `fuse_agents` | Destroys the fodder agent — this is irreversible |

---

## Troubleshooting

### \"Authentication required\" on mutation tools
→ You need `FORGE_PAT` or `FORGE_API_KEY` set in your environment. Generate one at [forge.tekup.dk/account](https://forge.tekup.dk/account).

### \"Cannot find module\" errors
→ Run `npm install` then `npm run build`.

### \"Failed to fetch\" / \"fetch is not defined\"
→ Forge MCP requires Node.js 18+ (the `fetch` API is built-in). Check `node --version`.

### \"resources/list\" returns nothing
→ Ensure `npm run build` completed successfully. Test stdio mode: `echo '{"jsonrpc":"2.0","id":1,"method":"resources/list"}' | node build/index.js`

### \"Forge API error\" messages
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
│   ├── index.ts          # MCP server source (stdio)
│   ├── http-server.ts    # HTTP server wrapper + health endpoints
│   ├── shared.ts         # Shared config, auth, API client, MCP handlers
│   └── resilience.ts     # Response validation, retry, health tracking
├── build/                 # Compiled output (gitignored)
├── tests/
│   ├── smoke.mjs          # stdio smoke test (no API calls)
│   ├── test-auth.mjs      # Auth unit tests
│   ├── test-resilience.mjs # Resilience layer tests
│   └── test-http.mjs      # HTTP server tests
├── DEPLOY.md              # Production deployment runbook
├── forge.env.example      # Config template
├── package.json
└── tsconfig.json
```

---

## Release Checklist

Before tagging a public release:

- [ ] `npm test` passes (78 smoke + 17 unit)
- [ ] `npm run build` succeeds cleanly
- [ ] `npm run smoke` passes (stdio contract verification)
- [ ] All mutation tools require auth (verified)
- [ ] Tokens masked in logs, errors, and responses (audited)
- [ ] README is current (resources, tools, prompts, endpoints)
- [ ] MCP Inspector shows all 9 tools / 3 resources / 3 prompts
- [ ] HTTP health endpoints respond correctly
- [ ] `forge.env` not tracked in git
- [ ] Version bumped in `package.json`
- [ ] License file present
- [ ] DEPLOY.md reflects current deployment model

---

## Deployment

See [`DEPLOY.md`](DEPLOY.md) for:
- systemd service setup
- Environment configuration
- Deploy flow (pull → build → test → restart)
- Health check endpoints
- Logging via journald

---

## License

MIT — see [LICENSE](LICENSE).

---

## Resources

- [Model Context Protocol](https://modelcontextprotocol.io)
- [Hermes Forge Platform](https://forge.tekup.dk)
- [Hermes Agent](https://hermes-agent.nousresearch.com)
- [Issue Tracker](https://github.com/JonasAbde/hermes-forge-mcp/issues)
