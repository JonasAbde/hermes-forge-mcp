# .agentops — Agent Operations for forge-mcp

This directory defines the **agent operations** layer for the forge-mcp repository. It provides AI agents (subagents) and their tooling to automate common development and ops tasks specific to running an MCP server.

## Structure

| Path | Purpose |
|------|---------|
| `skills/` | Reusable skill definitions (SKILL.md format, auto-discovered by OpenClaw) |
| `subagents/` | Subagent configurations for automated workflows |
| `mcp/` | MCP server configurations for tool/service access |
| `security/` | Security boundaries, blast radius, and guardrails |

## MCP Server Context

forge-mcp is an npm-published TypeScript package that implements the Model Context Protocol (MCP). It provides a set of MCP tools for discovering, opening, fusing, and deploying AI Agent Packs from the Hermes Forge platform.

Key differences from the main Forge platform:
- **No database** — stateless, proxying to the Forge API
- **Dual transport** — HTTP+SSE and stdio
- **npm-published** — versioned and released independently
- **No server restart needed** for config changes (MCP reconnects)
