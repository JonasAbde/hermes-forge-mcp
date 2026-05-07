# Hermes Forge MCP Server

[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blue)](https://modelcontextprotocol.io)

An [MCP](https://modelcontextprotocol.io) server that bridges AI assistants to the **Hermes Forge** AI Agent Platform. Enables any MCP-compatible client (Claude Desktop, Cursor, Windsurf, etc.) to discover, open, chat with, fuse, and deploy AI Agent Packs.

## Features

### Resources
| URI | Description |
|-----|-------------|
| `forge://packs` | List all Agent Packs in the Hermes Forge catalog |
| `forge://agents` | List the authenticated user's collected agents |
| `forge://user/profile` | Get the authenticated user's profile |

### Tools
| Tool | Description |
|------|-------------|
| `open_pack` | Open/reveal a new agent from a pack (creates an agent in your collection) |
| `chat_with_agent` | Send a message to an agent in a chat session (auto-rewards 25 XP) |
| `fuse_agents` | Fuse two agents together (Synthesis — 85% success / 15% Core Fracture) |
| `get_xp` | Get XP, level, and level progress for an agent |
| `subscribe_tier` | Get subscription tier and usage limits |
| `deploy_agent_to_telegram` | Deploy an agent to Telegram via webhook |
| `get_magic_link` | Request a magic link for email-based authentication |

### Prompts
| Prompt | Description |
|--------|-------------|
| `agent_card` | Generate a formatted agent card overview (stats, level, XP, rarity, fusions) |
| `pack_summary` | Summarize an Agent Pack (description, capabilities, rarity, trust metrics) |
| `fusion_guide` | Guide explaining agent fusion mechanics with optional specific agent projections |

## Installation

```bash
# Clone or copy the project
cd /path/to/hermes-forge-mcp

# Install dependencies
npm install

# Build
npm run build
```

## Configuration

Create a `forge.env` file in the project root:

```bash
# Hermes Forge API base URL
FORGE_API_BASE_URL=https://forge.tekup.dk/api/forge

# Option 1: Personal Access Token (PAT) — recommended for programmatic access
# Generate at forge.tekup.dk/account
FORGE_PAT=hfp_your_pat_here

# Option 2: API Key
# FORGE_API_KEY=forge_key_your_api_key_here

# Option 3: Email (for magic link auth)
# FORGE_EMAIL=user@example.com
```

## Usage with MCP Clients

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hermes-forge": {
      "command": "node",
      "args": ["/path/to/hermes-forge-mcp/build/index.js"],
      "env": {
        "FORGE_API_BASE_URL": "https://forge.tekup.dk/api/forge",
        "FORGE_PAT": "hfp_your_pat_here"
      }
    }
  }
}
```

### Cursor / Windsurf / Other MCP Clients

Use the same pattern — set the command to `node /path/to/hermes-forge-mcp/build/index.js` and pass environment variables for authentication.

### Direct stdio (for testing)

```bash
# Test with a simple echo
echo '{"jsonrpc":"2.0","id":1,"method":"resources/list"}' | node build/index.js

# Or use the MCP Inspector
npm run inspect
```

## Development

```bash
# Run with hot reload
npm run dev

# Build TypeScript
npm run build

# Inspect with MCP Inspector
npm run inspect
```

## Architecture

The MCP server acts as a thin proxy between MCP clients and the Hermes Forge REST API at `https://forge.tekup.dk/api/forge`:

```
MCP Client (Claude, Cursor, etc.)
       │
       ▼
Hermes Forge MCP Server (stdio transport)
       │
       ▼
Forge REST API (forge.tekup.dk/api/forge)
       │
       ▼
SQLite (forge.db) + Catalog
```

- **Resources** map to read-only API calls (`GET /packs`, `GET /v1/agents`, `GET /v1/me`)
- **Tools** map to mutation API calls (`POST /v1/agents`, `POST /v1/chat/sessions`, etc.)
- **Prompts** are template-based, fetching live data from the API and formatting it

## Example Interactions

### "What agents are available?"
→ Reads `forge://packs` resource

### "Open the Hermes Agent pack"
→ Calls `open_pack` tool with `packId: "hermes-agent"`

### "Chat with my Hermes agent"
→ Calls `chat_with_agent` with `agentId` and `message`

### "Fuse my two agents"
→ Calls `fuse_agents` with `baseAgentId` and `fodderAgentId`

### "Deploy this agent to Telegram"
→ Calls `deploy_agent_to_telegram` with `agentId` and `telegramBotToken`

## License

MIT
