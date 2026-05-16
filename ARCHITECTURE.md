# Forge Ecosystem — Architecture Overview

The Forge ecosystem consists of 4 independent repositories that work together
through the Forge API.

```
┌──────────────────────────────────────────────────────────────────┐
│                    forge.tekup.dk (VPS)                         │
│                                                                  │
│  ┌─────────────────────────────┐  ┌───────────────────────────┐ │
│  │  hermes-forge-platform      │  │  hermes-forge-mcp         │ │
│  │  ├─ Forge Web (React SPA)   │  │  (MCP Server)            │ │
│  │  │  • Catalog / Collection  │  │  • Port 8641             │ │
│  │  │  • Forge Chat (route)    │  │  • 21 tools, 3 resources  │ │
│  │  │  • Arena / Fusion        │  │  • Proxies to Forge API  │ │
│  │  ├─ Forge API (Node/SQLite) │  │  • systemd service       │ │
│  │  │  • /api/forge/*          │  └───────────────────────────┘ │
│  │  │  • /api/auth/*           │                                  │
│  │  └─ Forge Docs (VitePress)  │  ┌───────────────────────────┐ │
│  └─────────────────────────────┘  │  hermes-forge-chat        │ │
│                                    │  (Standalone SPA)         │ │
│  ┌─────────────────────────────┐  │  • chat.tekup.dk (TBD)    │ │
│  │  hermes-forge-cli           │  │  • React/Vite app         │ │
│  │  • forge CLI tool           │  │  • Same code as platform  │ │
│  │  • npm i -g @hermes-forge/cli│  │  • Uses Forge API via env│ │
│  │  • 20+ commands             │  └───────────────────────────┘ │
│  │  • Talks to Forge API       │                                  │
│  │  • Manages MCP services     │                                  │
│  └─────────────────────────────┘                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Repositories

| Repo | GitHub | Live | Stack |
|------|--------|------|-------|
| **hermes-forge-platform** | JonasAbde/hermes-forge-platform | forge.tekup.dk | React 19 + Node/SQLite |
| **hermes-forge-mcp** | JonasAbde/hermes-forge-mcp | Port 8641 | TypeScript, MCP SDK |
| **hermes-forge-cli** | JonasAbde/hermes-forge-cli | npm package | TypeScript, Commander |
| **hermes-forge-chat** | JonasAbde/hermes-forge-chat | Standalone SPA | React 19 + Vite |

## Data Flow

```
MCP Client (Claude/Cursor)
    │
    ▼
hermes-forge-mcp (port 8641) ──► forge.tekup.dk/api/forge
                                       │
                                       ▼
                               Forge API (Node/SQLite)
                                       │
                              ┌────────┴────────┐
                              │                  │
                              ▼                  ▼
                       Forge Web SPA      Standalone Chat
                       (browser)          (browser)
```

```
Forge CLI (terminal)
    │
    ├──► forge.tekup.dk/api/forge (direct API calls)
    │
    └──► localhost:8641 (MCP management)
```

## API Endpoints (forge.tekup.dk/api/forge)

| Endpoint | Description |
|----------|-------------|
| `GET /packs` | List all Agent Packs |
| `GET /v1/me` | Get authenticated user |
| `GET /v1/me/tier` | Get subscription tier |
| `GET /v1/agents` | List user's agents |
| `POST /v1/agents` | Open pack (create agent) |
| `GET /v1/agents/:id` | Get agent detail with XP |
| `POST /v1/synthesis/fuse` | Fuse two agents |
| `POST /v1/chat/sessions` | Create chat session |
| `GET /v1/chat/sessions/:id` | Get session with messages |
| `POST /v1/chat/sessions/:id/messages` | Send message |
| `POST /v1/webhooks` | Create webhook |
| `POST /v1/auth/magic-link` | Request magic link |
| `GET /v1/webhooks/telegram/:token` | Telegram webhook handler |

## Integration Points

### Platform → MCP
- MCP calls the same Forge API that the platform exposes
- MCP provides an alternative access method (via Claude Desktop, Cursor, etc.)
- MCP does NOT add new functionality — it proxies existing API endpoints

### CLI → Platform
- CLI calls forge.tekup.dk/api/forge for remote operations (`forge remote`)
- CLI calls forge.tekup.dk for health/status checks
- CLI manages local development services (dev, docs, API)

### CLI → MCP
- CLI has MCP management commands (`forge mcp start/stop/status/test/tools`)
- Currently configured for the old Python MCP registry (port 5200)
- **TODO:** Update to use the new TypeScript MCP (port 8641)

### Chat → Platform
- Standalone chat calls forge.tekup.dk/api/forge for auth and sessions
- Chat uses the same API client as the platform web app
- Chat can be deployed independently

## Deployment

| Service | Deploy Method | Port |
|---------|--------------|------|
| Forge Web | rsync via deploy.sh | 443 (nginx) |
| Forge API | systemd + git pull | 5181 |
| Forge MCP | systemd + git pull | 8641 |
| Forge Chat | TBD (chat.tekup.dk) | TBD |

## Environment Variables

### hermes-forge-mcp
| Var | Description |
|-----|-------------|
| `FORGE_API_BASE_URL` | Forge API base URL |
| `FORGE_PAT` | Personal Access Token |
| `FORGE_API_KEY` | Alternative auth (API key) |
| `FORGE_EMAIL` | Email for magic link auth |
| `MCP_HTTP_PORT` | HTTP port (default 8641) |

### hermes-forge-chat
| Var | Description |
|-----|-------------|
| `VITE_FORGE_API_BASE` | Forge API base URL |
| `VITE_FORGE_APP_URL` | Chat app URL (for auth redirects) |
| `VITE_FORGE_RUNTIME_URL` | Runtime override |
| `VITE_FORGE_GATEWAY_URL` | Gateway override |

## Next Steps for Full Integration

1. **CLI → MCP v2** — Update `forge mcp` commands to work with the new TypeScript MCP
2. **Chat deploy** — Set up chat.tekup.dk pointing to standalone Forge Chat
3. **MCP tests** — Add tests for the MCP server (currently 0 tests)
4. **CLI integration tests** — Test `forge remote` against the live API
5. **Cross-repo CI** — Add GitHub Actions to all repos
