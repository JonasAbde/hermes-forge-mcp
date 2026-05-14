---
name: api-contract-review
description: Review MCP tool schemas and API contracts
license: MIT
metadata:
  author: AgentOps
---

# Skill: api-contract-review

Review MCP tool schemas and API contracts.

## Triggers
- "review API contract"
- "check tool schemas"
- "validate MCP interface"

## Procedure
1. List all tool definitions from `src/index.ts`
2. Verify each tool has: name, description, inputSchema
3. Validate JSON Schema compliance
4. Check required fields vs optional fields
5. Verify error handling in handler functions
6. Compare against MCP specification
