# AIR MCP Server

[![npm version](https://img.shields.io/npm/v/@thalus-ai/mcp-air.svg)](https://www.npmjs.com/package/@thalus-ai/mcp-air)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Connect AI assistants to [AIR](https://air.thalus.ai) (AI Responsibly) for governed risk assessments: discover projects, upload evidence, run assessments, and retrieve structured reports — from **Cursor**, **Claude Code**, **Claude Desktop**, **VS Code**, **Windsurf**, or any [Model Context Protocol](https://modelcontextprotocol.io/) client.

This package ships two transports:

| Transport           | Who uses it                                        | How                                                  |
| ------------------- | -------------------------------------------------- | ---------------------------------------------------- |
| **stdio** (default) | Local IDE agents (Cursor, Claude Code, VS Code, …) | `npx @thalus-ai/mcp-air` + `AIR_API_KEY`             |
| **Streamable HTTP** | Claude Directory / remote MCP clients              | Hosted at `https://mcp.air.thalus.ai/mcp` with OAuth |

Local assessment workloads still execute on Thalus cloud via the [AIR Integrator API](https://air.thalus.ai/docs/guides/getting-started). You provide a domain-scoped API key for stdio; remote Directory clients authorize through the AIR portal (OAuth). No local database, worker, or Docker stack is required for stdio.

## Overview

```
┌──────────────────────┐   stdio MCP   ┌──────────────────┐   HTTPS   ┌─────────────────┐
│  Your IDE / agent    │ ◄────────────► │  @thalus-ai/     │ ────────► │  AIR Integrator │
│  (Cursor, Claude,    │               │  mcp-air (local) │           │  API (cloud)    │
│   VS Code, …)        │               └──────────────────┘           └─────────────────┘
└──────────────────────┘
```

| Component        | Role                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------- |
| **This server**  | Exposes MCP tools, resources, and prompts; translates agent requests to Integrator API calls |
| **AIR cloud**    | Document extraction, risk pipeline, billing, and report generation                           |
| **Your API key** | Domain-scoped bearer token created in the [AIR portal](https://air.thalus.ai)                |

## Prerequisites

- **Node.js 20+**
- An [AIR](https://air.thalus.ai) organization with active billing (assessments consume credits)
- A **domain-scoped API key** with scopes appropriate for your workflow (see [API key scopes](#api-key-scopes))

## Quick start

### 1. Create an API key

In the [AIR portal](https://air.thalus.ai): open your domain → **API Keys** → create a key with the `assessmentRunner` or `fullPipeline` preset (see below).

### 2. Configure your MCP client

Add the server to whichever client you use. All clients run the same `npx` command; only the config file and JSON root key differ.

**Most clients** (Cursor, Claude Code, Claude Desktop, Windsurf) — `mcpServers`:

```json
{
  "mcpServers": {
    "air": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@thalus-ai/mcp-air@1.1.0"],
      "env": {
        "AIR_API_KEY": "${env:AIR_API_KEY}"
      }
    }
  }
}
```

**VS Code** — `servers` in `.vscode/mcp.json` ([docs](https://code.visualstudio.com/docs/agent-customization/mcp-servers)):

```json
{
  "servers": {
    "air": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@thalus-ai/mcp-air@1.1.0"],
      "env": {
        "AIR_API_KEY": "${env:AIR_API_KEY}"
      }
    }
  }
}
```

Set `AIR_API_KEY` in your shell, or use `envFile` where supported. See [Client setup](#client-setup) for file paths per IDE.

### 3. Verify

Ask your agent to run `air_list_domains` and `air_list_projects`. You should see successful tool calls in the MCP log.

**MCP Inspector** (optional):

```bash
AIR_API_KEY=your-key npx @modelcontextprotocol/inspector npx -y @thalus-ai/mcp-air@1.1.0
```

## Remote HTTP (operators)

Hosted endpoint: `https://mcp.air.thalus.ai/mcp`.

```bash
# After build
AIR_API_URL=https://api.air.thalus.ai \
REDIS_URL=redis://127.0.0.1:6379 \
OAUTH_INTROSPECT_CLIENT_ID=your-resource-server-client-id \
OAUTH_INTROSPECT_CLIENT_SECRET=your-resource-server-client-secret \
MCP_HTTP_PORT=4104 \
node dist/build/http.mjs
```

Deploy notes, Angie, and systemd units live in [`infra/`](./infra/). Claude Directory users connect via OAuth on `air.thalus.ai` — see [Remote MCP OAuth](https://air.thalus.ai/docs/guides/mcp-remote-oauth) once published.

## Configuration

You only need **`AIR_API_KEY`**. The server connects to production AIR automatically.

### API key scopes

Choose a portal preset when creating your key:

| Preset                 | Use when                                                                         | Scopes (summary)                                                              |
| ---------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **`assessmentRunner`** | List domains/projects, start assessments, read reports on **existing** artifacts | `assessments:read/write`, `projects:read`, `domains:read`                     |
| **`fullPipeline`**     | Upload documents, search, domain portfolio, create projects                      | Above plus `projects:write`, `search:read`, `portfolio:read`, `domains:write` |

| Capability                                                              | Minimum preset     |
| ----------------------------------------------------------------------- | ------------------ |
| `air_list_domains`, `air_start_assessment`, `air_get_assessment_report` | `assessmentRunner` |
| `air_upload_document_*`, `air_run_assessment_from_file`                 | **`fullPipeline`** |
| `air_search`, `air_get_domain_portfolio`, `air_create_project`          | **`fullPipeline`** |

Org-wide portfolio dashboards require a browser session in the portal and are not available via MCP.

Full scope reference: [Authentication guide](https://air.thalus.ai/docs/guides/authentication).

## Client setup

| Client             | Config file                                                            | Notes                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cursor**         | `.cursor/mcp.json` or `~/.cursor/mcp.json`                             | Restart after changes                                                                                                                           |
| **Claude Code**    | `.mcp.json` or `~/.claude.json`                                        | Or: `claude mcp add --env AIR_API_KEY=… --transport stdio air -- npx -y @thalus-ai/mcp-air@1.1.0` — [docs](https://code.claude.com/docs/en/mcp) |
| **Claude Desktop** | See platform paths below                                               | Quit and reopen the app                                                                                                                         |
| **VS Code**        | `.vscode/mcp.json` or user config via **MCP: Open User Configuration** | Use Copilot **Agent** mode; root key is `servers`                                                                                               |
| **Windsurf**       | `~/.codeium/windsurf/mcp_config.json`                                  | Same `mcpServers` JSON as Cursor                                                                                                                |
| **Other**          | Your client's MCP docs                                                 | Same `command`, `args`, and `AIR_API_KEY`                                                                                                       |

### Claude Desktop paths

| Platform | Path                                                              |
| -------- | ----------------------------------------------------------------- |
| macOS    | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows  | `%APPDATA%\Claude\claude_desktop_config.json`                     |

Logs (macOS): `~/Library/Logs/Claude/mcp*.log`

Full walkthrough: [air.thalus.ai/docs/mcp-air-setup](https://air.thalus.ai/docs/guides/mcp-air-setup)

## Capabilities

### Tools (25)

| Category        | Tools                                                                                                                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Discovery**   | `air_list_domains`, `air_get_domain`, `air_list_projects`, `air_get_project`, `air_create_project`, `air_search`                                                                                                            |
| **Documents**   | `air_list_documents`, `air_get_document_download_url`, `air_list_artifacts`, `air_get_artifact_text`, `air_upload_document_init`, `air_upload_document_complete`                                                            |
| **Assessments** | `air_list_assessments`, `air_get_assessment`, `air_get_assessment_report`, `air_get_assessment_summary`, `air_list_open_facts`, `air_submit_fact_answers`, `air_get_assessment_stages`, `air_get_assessment_input_artifacts`, `air_create_assessment_draft`, `air_start_assessment`, `air_retry_assessment` |
| **Portfolio**   | `air_get_domain_portfolio`                                                                                                                                                                                                  |
| **Composites**  | `air_wait_for_document_extraction`, `air_wait_for_assessment`, `air_run_assessment_from_file`, `air_run_full_assessment_pipeline`                                                                                           |

`air_wait_for_*` tools block with exponential backoff until the resource is ready or `timeoutMs` elapses (capped at the configured defaults). Pipeline tools (`air_run_assessment_from_file`, `air_run_full_assessment_pipeline`) use the [MCP Tasks extension](https://modelcontextprotocol.io/extensions/tasks/overview) and return a task handle immediately — those require a Tasks-capable client.

### Resources (3 templates)

| URI pattern                                | Description                      |
| ------------------------------------------ | -------------------------------- |
| `air://assessments/{assessmentPid}/report` | Completed assessment report JSON |
| `air://assessments/{assessmentPid}/stages` | Stage execution log              |
| `air://projects/{projectPid}/assessments`  | Assessments for a project        |

### Prompts (3)

| Name                       | Purpose                                 |
| -------------------------- | --------------------------------------- |
| `run-assessment-workflow`  | End-to-end assessment workflow guidance |
| `review-assessment-report` | Structured report review                |
| `explore-portfolio`        | Domain portfolio exploration            |

## Typical workflow

1. `air_list_domains` → obtain `domainPid`
2. `air_list_projects` → obtain `projectPid` (or `air_create_project` with **fullPipeline**)
3. Upload evidence: `air_run_assessment_from_file` or manual init → PUT → complete → `air_wait_for_document_extraction`
4. `air_start_assessment` with `artifactPids` from `air_list_artifacts`
5. `air_wait_for_assessment`
6. `air_get_assessment_report` or read the `air://assessments/{id}/report` resource

See the [Integration flow guide](https://air.thalus.ai/docs/guides/integration-flow) for the underlying HTTP API sequence.

## Development

Contributors: see [AGENTS.md](./AGENTS.md) for build, test, publish, and optional `AIR_API_URL` override.

```bash
git clone https://github.com/VericyIO/mcp-air.git
cd mcp-air && pnpm install && pnpm build
pnpm test
```

## Documentation

| Resource                | URL                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| MCP setup guide         | [air.thalus.ai/docs/mcp-air-setup](https://air.thalus.ai/docs/guides/mcp-air-setup)            |
| Integrator API guides   | [air.thalus.ai/docs/guides/getting-started](https://air.thalus.ai/docs/guides/getting-started) |
| API reference           | [air.thalus.ai/docs/api-reference](https://air.thalus.ai/docs/api-reference/)                  |
| Agent skills (optional) | [github.com/VericyIO/thalus-air-skills](https://github.com/VericyIO/thalus-air-skills)         |

## Security

- The MCP process runs with your OS user privileges. Tools such as `air_run_assessment_from_file` can read any local path your user can access.
- Pin the package version in production (`@thalus-ai/mcp-air@1.1.0`) rather than floating `@latest`.
- Use least-privilege API key scopes. Write tools (`air_start_assessment`, uploads) consume organization credits.
- Never commit API keys. Use `env` or `envFile` in MCP client configuration.

## License

MIT — see [LICENSE](./LICENSE).

## Related repositories

- [VericyIO/mcp-air](https://github.com/VericyIO/mcp-air) — this server (source)
- [VericyIO/thalus-air-skills](https://github.com/VericyIO/thalus-air-skills) — optional agent skills for MCP workflows

Maintainer notes (build, publish, constants sync): see [AGENTS.md](./AGENTS.md).
