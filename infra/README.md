# MCP HTTP host deploy notes

Dedicated server for `@thalus-ai/mcp-air` Streamable HTTP (`mcp-server-air-http`).

## Checklist

1. DNS `mcp.air.thalus.ai` → this server (not the main AIR API host).
2. Install Node 20+ (fnm), Redis, Angie with ACME.
3. Checkout/build mcp-air (or deploy published package artifact) under `/srv/mcp-air`.
4. Copy `env.example` → `/srv/mcp-air/.env` and fill introspection + Redis values.
5. Install `infra/systemd/thalus-air-mcp.service` and enable it.
6. Install `infra/angie/mcp-air.conf`, reload Angie.
7. Verify:
   - `curl -fsS https://mcp.air.thalus.ai/health` → `ok`
   - Unauthenticated MCP initialize → `401` + `WWW-Authenticate` with protected-resource metadata

## Required env

| Variable | Purpose |
|----------|---------|
| `AIR_API_URL` | Integrator + introspection base (`https://api.air.thalus.ai`) |
| `OAUTH_INTROSPECT_CLIENT_ID` / `SECRET` | Authenticated RFC 7662 client (tighten before Directory launch) |
| `REDIS_URL` | Task state for composite MCP tools |
| `MCP_HTTP_*` | Bind host/port/path behind Angie |

Firewall: ingress 443 only; egress to `api.air.thalus.ai:443`.
