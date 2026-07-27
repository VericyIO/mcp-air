# AIR MCP Server

[![npm version](https://img.shields.io/npm/v/@thalus-ai/mcp-air.svg)](https://www.npmjs.com/package/@thalus-ai/mcp-air)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Connect AI assistants to [AIR](https://air.thalus.ai) (AI Responsibly) for governed risk assessments: discover projects, upload evidence, run assessments, and retrieve structured reports — from Cursor, Claude Desktop, VS Code, or any [Model Context Protocol](https://modelcontextprotocol.io/) client.

This package runs **locally** as a stdio MCP server. Assessment workloads execute on Thalus cloud infrastructure via the [AIR Integrator API](https://air.thalus.ai/docs/guides/getting-started). You provide a domain-scoped API key; no local database, worker, or Docker stack is required.

## Overview

```
┌─────────────────┐     stdio MCP      ┌──────────────────┐     HTTPS      ┌─────────────────┐
│  Cursor / Claude │ ◄────────────────► │  @thalus-ai/     │ ─────────────► │  AIR Integrator │
│  / VS Code       │                    │  mcp-air (local) │                │  API (cloud)    │
└─────────────────┘                    └──────────────────┘                └─────────────────┘
```

| Component | Role |
| --------- | ---- |
| **This server** | Exposes MCP tools, resources, and prompts; translates agent requests to Integrator API calls |
| **AIR cloud** | Document extraction, risk pipeline, billing, and report generation |
| **Your API key** | Domain-scoped bearer token created in the [AIR portal](https://air.thalus.ai) |

## Prerequisites

- **Node.js 20+**
- An [AIR](https://air.thalus.ai) organization with active billing (assessments consume credits)
- A **domain-scoped API key** with scopes appropriate for your workflow (see [API key scopes](#api-key-scopes))

## Quick start

### 1. Create an API key

In the [AIR portal](https://air.thalus.ai): open your domain → **API Keys** → create a key with the `assessmentRunner` or `fullPipeline` preset (see below).

### 2. Configure your MCP client

**Cursor** — add to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "air": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@thalus-ai/mcp-air@1.0.0"],
      "env": {
        "AIR_API_KEY": "${env:AIR_API_KEY}"
      }
    }
  }
}
```

Set `AIR_API_KEY` in your shell environment, or use `envFile` to load it from a file. Restart the client after saving.

### 3. Verify

Ask your agent to run `air_list_domains` and `air_list_projects`. You should see successful tool calls in the MCP log.

**MCP Inspector** (optional):

```bash
AIR_API_KEY=your-key npx @modelcontextprotocol/inspector npx -y @thalus-ai/mcp-air@1.0.0
```

## Configuration

### Environment variables

| Variable | Required | Default | Description |
| -------- | -------- | ------- | ----------- |
| `AIR_API_KEY` | Yes | — | Domain-scoped bearer API key from the AIR portal |
| `AIR_API_URL` | No | `https://api.air.thalus.ai` | Integrator API base URL. Override only for [local development](#development) or staging (`https://api.air-dev.thalus.ai`). |

> **Note:** `https://api.air.thalus.ai` is the API **base URL** (health check: `GET /` returns `{"name":"air-api","status":"ok",...}`). For human-readable API documentation, use the links in [Documentation](#documentation) below — not the bare API origin.

### API key scopes

Choose a portal preset when creating your key:

| Preset | Use when | Scopes (summary) |
| ------ | -------- | ---------------- |
| **`assessmentRunner`** | List domains/projects, start assessments, read reports on **existing** artifacts | `assessments:read/write`, `projects:read`, `domains:read` |
| **`fullPipeline`** | Upload documents, search, domain portfolio, create projects | Above plus `projects:write`, `search:read`, `portfolio:read`, `domains:write` |

| Capability | Minimum preset |
| ---------- | -------------- |
| `air_list_domains`, `air_start_assessment`, `air_get_assessment_report` | `assessmentRunner` |
| `air_upload_document_*`, `air_run_assessment_from_file` | **`fullPipeline`** |
| `air_search`, `air_get_domain_portfolio`, `air_create_project` | **`fullPipeline`** |

Org-wide portfolio dashboards require a browser session in the portal and are not available via MCP.

Full scope reference: [Authentication guide](https://air.thalus.ai/docs/guides/authentication).

## Client setup

### Claude Desktop

Use the same `mcpServers` JSON as Cursor. Config file locations:

| Platform | Path |
| -------- | ---- |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

Restart Claude Desktop after changes. Logs: `~/Library/Logs/Claude/mcp*.log` (macOS).

### VS Code

Add the server to your MCP configuration per [VS Code MCP documentation](https://code.visualstudio.com/docs/copilot/customization/mcp-servers). Use the same `npx` command and `AIR_API_KEY` environment variable as above.

## Capabilities

### Tools (25)

| Category | Tools |
| -------- | ----- |
| **Discovery** | `air_list_domains`, `air_get_domain`, `air_list_projects`, `air_get_project`, `air_create_project`, `air_search` |
| **Documents** | `air_list_documents`, `air_get_document_download_url`, `air_list_artifacts`, `air_get_artifact_text`, `air_upload_document_init`, `air_upload_document_complete` |
| **Assessments** | `air_list_assessments`, `air_get_assessment`, `air_get_assessment_report`, `air_get_assessment_stages`, `air_get_assessment_input_artifacts`, `air_create_assessment_draft`, `air_start_assessment`, `air_retry_assessment` |
| **Portfolio** | `air_get_domain_portfolio` |
| **Composites** | `air_wait_for_document_extraction`, `air_wait_for_assessment`, `air_run_assessment_from_file`, `air_run_full_assessment_pipeline` |

Composite wait tools use the [MCP Tasks extension](https://modelcontextprotocol.io/extensions/tasks/overview) and return a task handle immediately instead of blocking for up to 30 minutes. Clients without Tasks support should poll with `air_get_assessment` or `air_list_documents` manually.

### Resources (3 templates)

| URI pattern | Description |
| ----------- | ----------- |
| `air://assessments/{assessmentPid}/report` | Completed assessment report JSON |
| `air://assessments/{assessmentPid}/stages` | Stage execution log |
| `air://projects/{projectPid}/assessments` | Assessments for a project |

### Prompts (3)

| Name | Purpose |
| ---- | ------- |
| `run-assessment-workflow` | End-to-end assessment workflow guidance |
| `review-assessment-report` | Structured report review |
| `explore-portfolio` | Domain portfolio exploration |

## Typical workflow

1. `air_list_domains` → obtain `domainPid`
2. `air_list_projects` → obtain `projectPid` (or `air_create_project` with **fullPipeline**)
3. Upload evidence: `air_run_assessment_from_file` or manual init → PUT → complete → `air_wait_for_document_extraction`
4. `air_start_assessment` with `artifactPids` from `air_list_artifacts`
5. `air_wait_for_assessment`
6. `air_get_assessment_report` or read the `air://assessments/{id}/report` resource

See the [Integration flow guide](https://air.thalus.ai/docs/guides/integration-flow) for the underlying HTTP API sequence.

## Development

Clone and run from source:

```bash
git clone https://github.com/VericyIO/mcp-air.git
cd mcp-air
pnpm install
pnpm build
AIR_API_KEY=your-key node dist/build/index.mjs
```

Point your MCP client at `dist/build/index.mjs` instead of `npx`. For local AIR API development, set `AIR_API_URL=http://localhost:4001`.

```bash
pnpm typecheck   # TypeScript
pnpm test        # Unit and protocol tests
pnpm prepublishOnly  # Build + bundle verification
```

## Documentation

| Resource | URL |
| -------- | --- |
| MCP setup guide (detailed) | [air.thalus.ai/docs/mcp-air-setup](https://air.thalus.ai/docs/mcp-air-setup) |
| Integrator API getting started | [air.thalus.ai/docs/guides/getting-started](https://air.thalus.ai/docs/guides/getting-started) |
| API reference (OpenAPI) | [air.thalus.ai/docs/api-reference](https://air.thalus.ai/docs/api-reference/) |
| Interactive API explorer | [api.air.thalus.ai/docs](https://api.air.thalus.ai/docs) |
| OpenAPI JSON | [api.air.thalus.ai/openapi.json](https://api.air.thalus.ai/openapi.json) |
| Agent skills (optional) | [github.com/VericyIO/thalus-air-skills](https://github.com/VericyIO/thalus-air-skills) |

## Security

- The MCP process runs with your OS user privileges. Tools such as `air_run_assessment_from_file` can read any local path your user can access.
- Pin the package version in production (`@thalus-ai/mcp-air@1.0.0`) rather than floating `@latest`.
- Use least-privilege API key scopes. Write tools (`air_start_assessment`, uploads) consume organization credits.
- Never commit API keys. Use `env` or `envFile` in MCP client configuration.

## License

MIT — see [LICENSE](./LICENSE).

## Related repositories

- [VericyIO/mcp-air](https://github.com/VericyIO/mcp-air) — this server (source)
- [VericyIO/thalus-air-skills](https://github.com/VericyIO/thalus-air-skills) — optional agent skills for MCP workflows

Maintainer notes (build, publish, constants sync): see [AGENTS.md](./AGENTS.md).
