# SECURITY.md — forge-mcp

## Security Practices

### Dependency Management
- `npm audit` run as part of CI
- Dependabot configured for automated security updates
- Pin major versions, review minor/patch bumps
- No unused dependencies in production

### Input Validation
- All MCP tool inputs validated via JSON Schema
- No `eval()`, `new Function()`, or `child_process.exec()` with user input
- Input length limits applied where appropriate

### Secrets Management
- No secrets in code or config files
- API tokens passed as environment variables or MCP tool arguments
- `.env.example` documents required vars without values
- `.gitignore` excludes `.env` files

### Supply Chain Security
- npm account has 2FA enabled
- Publishing only via GitHub Actions CI (`.github/workflows/publish.yml`)
- Git tags signed
- `package-lock.json` committed for deterministic installs

### Transport Security
- HTTP+SSE: rate-limited via `express-rate-limit`
- Stdio: restricted to working directory
- No CORS to untrusted origins

### Vulnerability Reporting
Report vulnerabilities by opening an issue on GitHub:
https://github.com/JonasAbde/hermes-forge-mcp/issues
