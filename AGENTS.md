# AGENTS.md

## AI Agent Instructions — Hermes Forge MCP Server

### Project Overview

**forge-mcp** is a **Model Context Protocol (MCP) server** for the Hermes Forge platform. It enables MCP-compatible AI clients to discover, open, chat with, fuse, and deploy AI Agent Packs via the MCP standard protocol (HTTP + SSE / stdio).

| Component | Stack | Notes |
|-----------|-------|-------|
| **MCP Server** | TypeScript / Node.js | Handles MCP protocol requests |
| **HTTP Server** | Express + MCP SDK | HTTP+SSE transport layer |
| **Stdio Server** | MCP SDK | stdio transport for local MCP clients |

**Repository:** https://github.com/JonasAbde/hermes-forge-mcp

### Key Architectural Notes

1. **Dual transport:** The server supports both HTTP+SSE (`http-server.ts`) and stdio (`index.ts`) transports. The HTTP server is the primary deployment target; stdio is for local/embedded MCP client use.

2. **MCP tool definitions:** Tools are defined in `src/index.ts` using the MCP SDK. Each tool has a name, description, input schema (JSON Schema), and handler function.

3. **No database:** The MCP server is stateless — it proxies requests to the Hermes Forge API. No SQLite, no persistence.

4. **Authentication:** API tokens are passed via MCP tool arguments. No built-in auth layer — trust is delegated to the MCP client.

5. **Caching:** In-memory response caching in `src/cache.ts` with TTL-based expiration for frequently accessed data (packs, deployments).

6. **Resilience:** `src/resilience.ts` provides retry logic, circuit breaker, and fallback behavior for upstream Forge API calls.

### Repo Map

```
src/
  index.ts          — Stdio MCP server entry point (tool definitions)
  http-server.ts    — Express MCP server entry point (HTTP+SSE)
  discovery.ts      — Agent pack discovery & search
  evolution.ts      — Agent fusion/synthesis logic
  cache.ts          — In-memory TTL cache
  resilience.ts     — Retry, circuit breaker, fallbacks
  logger.ts         — Logging utilities
  shared.ts         — Shared types and constants
tests/
  smoke.mjs         — Smoke test suite
  test-auth.mjs     — Auth flow tests
  test-http.mjs     — HTTP server integration tests
  test-resilience.mjs — Resilience mechanism tests
  test-tools.mjs    — MCP tool definition tests
scripts/
  check-repo-boundaries.mjs — Repo boundary validation
  gh-set-status.sh          — GitHub status updater
docs/               — Documentation
.github/
  workflows/
    ci.yml          — CI workflow
    publish.yml     — npm publish workflow
.hermes/
  plans/            — Hermes agent plans
```

### Build

```bash
npm run build        # tsc → build/
npm start            # Run HTTP server
npm run start:stdio  # Run stdio server
npm run dev          # Dev HTTP server with tsx
npm run dev:stdio    # Dev stdio server with tsx
```

### Test

```bash
npm test             # Smoke + auth + resilience + HTTP tests
npm run smoke        # Quick smoke test
```

### Lint / Format

```bash
npm run lint         # ESLint
npm run format       # Prettier check
npm run format:fix   # Prettier write
```

### Release

Published to npm as `forge-mcp`. See `docs/RELEASE_CHECKLIST.md`.

### Ops & Recovery

See `DEPLOY.md` for deployment instructions and `CHANGELOG.md` for version history.
