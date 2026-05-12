# Changelog

## [2.0.0] — 2026-05-12

### 🚀 Major Improvements

- **Caching layer** — In-memory TTL cache reduces API calls ~50%. Catalog caches 60s, agents 30s, profile 15s. Cache stats exposed in `/health` endpoint.
- **Structured logging** — JSON logger with levels (DEBUG/INFO/WARN/ERROR), request timing, and metadata. Writes to stderr (stdout kept clean for MCP protocol).
- **Auto-discovery** — Probes Forge API at startup for new endpoints. Logs any not yet exposed as MCP tools.

### ✨ New Tools

- `forge_get_agent` — Get full agent details (renamed from `get_xp` for clarity)
- `forge_list_leaderboard` — Top packs sorted by trust score (no auth required)

### 🧪 Test Infrastructure

- **37 tool unit tests** — Every tool tested in isolation with mocked API
- **192 smoke test assertions** — Full MCP contract verification
- **CI pipeline** — GitHub Actions: build → test → smoke (push/PR), +integration tests (tags)
- Total: **264+ tests** all passing

### 🔧 Ecosystem Integration

- CLI updated: default MCP port `5200` → `8641` (PR #4 in hermes-forge-cli)
- Health endpoint includes cache stats and tool list

### 📦 Full Toolset

10 tools, 3 resources, 3 prompts:
- `forge_list_packs`, `forge_get_pack`, `forge_get_agent`, `forge_list_leaderboard`
- `open_pack`, `chat_with_agent`, `fuse_agents`, `subscribe_tier`
- `deploy_agent_to_telegram`, `get_magic_link`
