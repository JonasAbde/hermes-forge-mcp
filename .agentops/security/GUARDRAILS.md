# GUARDRAILS.md — forge-mcp

## Operational Guardrails

### Before Pushing Code
1. `npm test` passes (all smoke, auth, resilience, HTTP tests)
2. `npm run build` passes (TypeScript compilation)
3. `npm run lint` has 0 errors
4. No secrets in code (API keys, tokens, passwords)
5. No `console.log` — use `src/logger.ts`

### Before Publishing to npm
1. Full test suite passes
2. `CHANGELOG.md` updated with release notes
3. Version bumped in `package.json`
4. Git tag created and pushed
5. CI workflow `.github/workflows/publish.yml` handles the publish
6. `NPM_TOKEN` secret is configured in GitHub repo

### MCP-Specific Guardrails
1. Every tool definition must have: `name`, `description`, `inputSchema`
2. All tool inputs validated against JSON Schema before handler execution
3. Error responses must not leak internal state or stack traces
4. Tool outputs must be serializable (no circular refs, no undefined)
5. Rate limiting: max 100 requests/minute per client on HTTP transport

### During Development
1. Feature branches off `main`
2. Branch naming: `feat/`, `fix/`, `chore/`, `docs/`
3. PR labels required: `enhancement`, `bug`, `documentation`, `chore`, `security`
4. All PRs must pass CI before merge
5. Force-push only to feature branches, never to `main`

### Incident Response
1. Malicious npm publish discovered → unpublish + deprecate + tag new version
2. Security vulnerability in dependency → update + patch release
3. API token leaked → rotate token + revoke exposed tokens + audit logs
