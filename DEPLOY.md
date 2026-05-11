# Forge MCP — Deployment

## Production (VPS - systemd)

The MCP server runs as a systemd service with auto-restart:

```bash
# Service status
sudo systemctl status forge-mcp.service

# Restart
sudo systemctl restart forge-mcp.service

# Logs
sudo journalctl -u forge-mcp.service -n 50 --no-pager
sudo journalctl -u forge-mcp.service -f  # follow
```

### Environment

Configure in `/home/ubuntu/projects/hermes-forge-mcp/forge.env`:

```
FORGE_PAT=hfp_your_token
FORGE_API_BASE_URL=https://forge.tekup.dk/api/forge
MCP_HTTP_PORT=8641
```

### Deployment flow

1. Pull changes: `cd /home/ubuntu/projects/hermes-forge-mcp && git pull origin main`
2. Build: `npm run build`
3. Test: `npm test && npm run smoke`
4. Restart: `sudo systemctl restart forge-mcp.service`
5. Verify: `curl http://127.0.0.1:8641/health`

## Architecture

```
MCP Client (Claude Desktop, Cursor, Hermes Agent)
       |
       v
Forge MCP Server (HTTP @ :8641 or stdio)
       |
       v
Forge REST API (forge.tekup.dk/api/forge/*)
```

## Transport modes

- **HTTP** (default for VPS): `build/http-server.js`, port 8641
- **Stdio** (local clients): `build/index.js`

## Health endpoints

- `GET /health` — Server + auth + API status
- `GET /health/tools` — Registered tools list
- `POST /mcp` — MCP protocol endpoint

## Monorepo integration

This MCP server does NOT have its own database or catalog. All data comes live from the Forge Platform API at `forge.tekup.dk/api/forge/*`. The platform is the single source of truth.
