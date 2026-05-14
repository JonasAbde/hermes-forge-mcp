# ACTIVE SESSION — forge-mcp

**Date:** 2026-05-14
**Session:** initial-setup
**Status:** Active development

---

## Summary

Initial setup of forge-mcp v2.0.0 — MCP server for the Hermes Forge platform. This session covers the AgentOps foundation: AGENTS.md, docs templates, and .agentops configuration.

---

## Working On

- [ ] AgentOps foundation — AGENTS.md, skills, subagents, MCP configs, guardrails
- [ ] Tool set validation against MCP protocol spec
- [ ] Transport layer hardening (HTTP+SSE and stdio)

---

## Key Decisions

- `AGENTS.md` defines agent identity with repo map covering `src/`, `tests/`, `scripts/`, `docs/`
- Release model: npm publish with CI/CD via GitHub Actions (`publish.yml`)
- No database — stateless MCP server proxying to Forge API

---

## Next Steps

1. Complete tool implementation audit
2. Verify all MCP tool schemas match JSON-RPC spec
3. Expand test coverage for edge cases

---

## Links

- **Repo:** https://github.com/JonasAbde/hermes-forge-mcp
- **NPM:** https://www.npmjs.com/package/forge-mcp
- **Architecture:** ARCHITECTURE.md
- **Deploy:** DEPLOY.md
