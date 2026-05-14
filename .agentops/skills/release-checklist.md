# Skill: release-checklist

Verify forge-mcp is ready for npm release.

## Triggers
- "prepare release"
- "check release readiness"
- "is it time to publish?"

## Procedure
1. Read `docs/RELEASE_CHECKLIST.md`
2. Verify version bump in `package.json`
3. Run `npm test && npm run build && npm run lint`
4. Check `CHANGELOG.md` is updated
5. Confirm `NPM_TOKEN` exists in repo secrets
6. Report pass/fail per checklist item
