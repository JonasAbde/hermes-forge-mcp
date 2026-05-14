# Skill: mcp-security-audit

Security audit specific to MCP protocol implementations.

## Triggers
- "audit security"
- "MCP security review"
- "check for vulnerabilities"

## Procedure
1. Scan `src/` for MCP tool definitions
2. Verify input validation in every tool handler
3. Check error messages don't leak internal details
4. Review dependency supply chain (`npm audit`)
5. Validate rate limiting on HTTP transport
6. Check no secrets in error responses or logs
