---
name: forge-cli-release
description: Publish workflow for the forge-mcp npm package
license: MIT
metadata:
  author: AgentOps
---

# Skill: forge-cli-release

Publish workflow for the forge-mcp npm package.

## Triggers
- "publish forge-mcp"
- "release new version"
- "npm publish"

## Procedure
1. Ensure on `main` branch
2. Run `npm run build && npm test && npm run lint`
3. Bump version: `npm version patch|minor|major`
4. Update `CHANGELOG.md`
5. Commit and push
6. Create git tag
7. Push tag (triggers CI publish workflow)
8. Verify published on npm
