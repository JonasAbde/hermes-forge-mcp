---
name: github-issue-to-pr
description: Convert a GitHub issue into a properly structured PR for forge-mcp
license: MIT
metadata:
  author: AgentOps
---

# Skill: github-issue-to-pr

Convert a GitHub issue into a properly structured PR for forge-mcp.

## Triggers
- "create a PR for issue #N"
- "fix issue #N"
- "implement #N"

## Procedure
1. Fetch issue content (`gh issue view N`)
2. Determine affected files (src/, tests/, docs/)
3. Create feature branch
4. Implement changes with tests
5. Open PR with proper template
6. Add label `enhancement` or `bug`
