# PR Checklist — forge-mcp

> Use this checklist before opening or merging a PR on the **forge-mcp** repository.

## PR Metadata

- [ ] PR title follows conventional commit format: `type(scope): description`
- [ ] PR has an appropriate label (`enhancement`, `bug`, `documentation`, `chore`, `security`)
- [ ] PR description includes: summary, change list, verification steps, risks

## MCP-Specific Items

### MCP Protocol Compatibility
- [ ] Tool definitions follow the MCP specification (JSON Schema input, typed outputs)
- [ ] New tool names use `snake_case` and are globally unique across all tools
- [ ] Transport layer (HTTP+SSE / stdio) handles both `initialize` and `listTools` handshakes
- [ ] Error responses follow MCP error codes (`-32600` Invalid Request, `-32601` Method Not Found, `-32603` Internal Error)
- [ ] If changing JSON-RPC message format, verify against `@modelcontextprotocol/sdk` version

### Tool Definition Accuracy
- [ ] Every new tool has: `name`, `description`, `inputSchema` (JSON Schema)
- [ ] Tool descriptions are clear, action-oriented, and useful for LLM auto-selection
- [ ] Input schemas use proper JSON Schema types (`string`, `number`, `boolean`, `array`, `object`)
- [ ] Required vs optional fields are correctly annotated
- [ ] Array/object item types are specified (no bare `"type": "array"` without `items`)

### Request/Response Schema Validation
- [ ] Tool handlers validate incoming parameters (type checks, required fields, bounds)
- [ ] Error responses include `error` with `code` and `message` fields
- [ ] Success responses return properly typed `content` array (text, image, resource)
- [ ] Responses handle pagination where applicable (cursor/offset support)
- [ ] All tool outputs are serializable (no circular references, no undefined values)

## Code Quality

- [ ] TypeScript: `npm run build` passes with 0 errors
- [ ] ESLint: `npm run lint` has no warnings or errors
- [ ] Prettier: `npm run format` passes
- [ ] No `console.log` (use `src/logger.ts` instead)
- [ ] No hardcoded secrets, API keys, or tokens
- [ ] No `any` types without explicit justification and `// eslint-disable-next-line` comment
- [ ] Async operations have proper error handling (try/catch or `.catch()`)
- [ ] New files follow existing naming conventions and directory structure

## Testing

- [ ] `npm test` passes (smoke + auth + resilience + HTTP)
- [ ] New features have corresponding test coverage
- [ ] Tests are deterministic (no flaky tests)
- [ ] Mocked upstream API calls where appropriate
- [ ] Edge cases covered: malformed input, missing fields, network timeouts

## Security

- [ ] No new dependencies added without review (supply chain risk)
- [ ] No secrets or tokens leak via error messages
- [ ] Input validation prevents injection attacks (no eval, no shell exec with user input)
- [ ] Rate limiting considerations documented if adding new endpoints

## Documentation

- [ ] `AGENTS.md` is updated if architecture changed
- [ ] `docs/RELEASE_CHECKLIST.md` is reviewed for any new steps
- [ ] `CHANGELOG.md` updated with PR description
- [ ] `README.md` is updated if CLI/flags/usage changed
- [ ] Tool descriptions in code are accurate and up to date

## Pre-Merge

- [ ] Branch is up-to-date with `main`
- [ ] No merge conflicts
- [ ] CI passes (GitHub Actions)
- [ ] Reviewed by at least 1 maintainer

## Post-Merge

- [ ] Verified on `main` (CI passes)
- [ ] Tagged if release-worthy
