# @thalus-ai/mcp-air

MCP server for [AIR](https://air.thalus.ai) — run risk assessments, upload evidence, and read reports from Cursor, Claude Desktop, or any MCP client.

Assessments run on Thalus cloud infrastructure via the [integrator API](https://api.air.thalus.ai). This package is a local stdio bridge; you only need an AIR API key.

## Quick start (production)

**You only need `AIR_API_KEY`.** The server defaults to `https://api.air.thalus.ai`.

1. Create a **domain-scoped API key** in the [AIR portal](https://air.thalus.ai) → your domain → **API Keys**.
2. Add to Cursor (`.cursor/mcp.json` or global `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "air": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@thalus-ai/mcp-air@1.0.1"],
      "env": {
        "AIR_API_KEY": "${env:AIR_API_KEY}"
      }
    }
  }
}
```

3. Set `AIR_API_KEY` in your shell or use `envFile` pointing at a file that contains it.
4. Restart Cursor and ask: _"Use air_list_domains and air_list_projects"_.

### API key presets

| Preset             | Use when                                         |
| ------------------ | ------------------------------------------------ |
| `assessmentRunner` | Read/start assessments on **existing** artifacts |
| `fullPipeline`     | Upload files, search, portfolio, create projects |

## Environment variables

| Variable      | Required | Default                     |
| ------------- | -------- | --------------------------- |
| `AIR_API_KEY` | **Yes**  | —                           |
| `AIR_API_URL` | No       | `https://api.air.thalus.ai` |

Set `AIR_API_URL` only for local dev (`http://localhost:4001`) or staging (`https://api.air-dev.thalus.ai`). Production users can omit it.

## Claude Desktop

Same JSON shape as Cursor. Config path:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

## Verify with MCP Inspector

```bash
AIR_API_KEY=your-key npx @modelcontextprotocol/inspector npx -y @thalus-ai/mcp-air@1.0.1
```

## What you get

- **25 tools** — domains, projects, documents, assessments, portfolio, composite pipelines
- **3 resource templates** — `air://assessments/{id}/report`, stages, project assessment lists
- **3 prompts** — assessment workflow, report review, portfolio exploration

Full setup guide: [air.thalus.ai/docs/mcp-air-setup](https://air.thalus.ai/docs/mcp-air-setup)

Source: [github.com/VericyIO/mcp-air](https://github.com/VericyIO/mcp-air)

## Requirements

- Node.js 20+
- Active AIR org with billing (assessments consume credits)

## License

MIT — see [LICENSE](./LICENSE).

## Publishing (maintainers)

1. Add `NPM_TOKEN` (publish access to `@thalus-ai`) as a GitHub secret on this repo.
2. Bump `version` in `package.json` and `server.json`.
3. Tag and push:

```bash
git tag mcp-air-v1.0.1
git push origin mcp-air-v1.0.1
```

GitHub Actions runs tests, builds, and publishes to npm.
