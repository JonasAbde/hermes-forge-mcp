# BLAST_RADIUS.md — forge-mcp

## Threat Model: MCP Server Context

forge-mcp is a **stateless MCP server** that proxies to the Hermes Forge API. It has:
- **No database** — no data persistence, no SQLite
- **No server restart needed** for config changes — MCP clients reconnect
- **Dual transport** — HTTP+SSE and stdio
- **npm-published package** — supply chain risk via dependencies

## Blast Radius per Attack Vector

| Vector | Blast Radius | Mitigation |
|--------|-------------|------------|
| **Compromised npm dependency** | Package consumers (anyone running forge-mcp) | Regular `npm audit`, dependency pinning, dependabot alerts |
| **Tool input injection** | Single MCP session | JSON Schema validation in every tool handler, no eval/exec from user input |
| **API token leak** | Upstream Forge API access | Token rotation, env-var only (no hardcoded tokens), minimal token scope |
| **Supply chain (malicious publish)** | All npm consumers | 2FA on npm account, CI-only publishing via `publish.yml`, signed tags |
| **HTTP transport DoS** | Server availability | Rate limiting via `express-rate-limit`, request size limits |
| **SSE connection flood** | Server memory | Max concurrent connections, connection timeout |
| **Stdio transport escape** | Host filesystem | Restricted working directory, no arbitrary file access from stdio |
| **Log leakage** | Information disclosure | Structured logging via `src/logger.ts`, no secrets in logs |

## Recovery

- **npm revert:** `npm unpublish forge-mcp@X.Y.Z --force` (within 72h)
- **Version deprecation:** `npm deprecate forge-mcp@X.Y.Z "message"`
- **Git revert:** `git revert <commit>` + force-push a `v*` tag override
