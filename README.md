# AIR MCP Server

[![npm version](https://img.shields.io/npm/v/@thalus-ai/mcp-air.svg)](https://www.npmjs.com/package/@thalus-ai/mcp-air)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Connect AI assistants to [AIR](https://air.thalus.ai) (AI Responsibly) for governed risk assessments: discover projects, upload evidence, run assessments, and retrieve structured reports — from **Cursor**, **Claude Code**, **Claude Desktop**, **VS Code**, **Windsurf**, or any [Model Context Protocol](https://modelcontextprotocol.io/) client.

This package ships two transports:

| Transport           | Who uses it                                        | How                                                  |
| ------------------- | -------------------------------------------------- | ---------------------------------------------------- |
| **stdio** (default) | Local IDE agents (Cursor, Claude Code, VS Code, …) | `npx @thalus-ai/mcp-air`, with or without a key      |
| **Streamable HTTP** | Claude Directory / remote MCP clients              | Hosted at `https://mcp.air.thalus.ai/mcp` with OAuth |

Local assessment workloads still execute on Thalus cloud via the [AIR Integrator API](https://air.thalus.ai/docs/guides/getting-started). For stdio you provide a domain-scoped API key, or let the server store one when you create an account in chat; remote Directory clients authorize through the AIR portal (OAuth). No local database, worker, or Docker stack is required for stdio.

**No AIR account?** The local server can create one from inside the conversation — see [Starting without an account](#starting-without-an-account). The hosted server gains the same flow with its next deploy.

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
- An [AIR](https://air.thalus.ai) organization with active billing (assessments consume credits) — or create one from the conversation, see [Starting without an account](#starting-without-an-account)
- A credential, from any of three sources — see [Credentials](#credentials). **None is needed to start**: with no credential the server boots in setup mode so you can create an account.

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
      "args": ["-y", "@thalus-ai/mcp-air@1.3.0"],
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
      "args": ["-y", "@thalus-ai/mcp-air@1.3.0"],
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
AIR_API_KEY=your-key npx @modelcontextprotocol/inspector npx -y @thalus-ai/mcp-air@1.3.0
```

## Remote HTTP (operators)

Hosted endpoint: `https://mcp.air.thalus.ai/mcp`.

```bash
# After build
AIR_API_URL=https://api.air.thalus.ai \
MCP_OAUTH_RESOURCE=https://mcp.air.thalus.ai/mcp \
REDIS_URL=redis://127.0.0.1:6379 \
OAUTH_INTROSPECT_CLIENT_ID=your-resource-server-client-id \
OAUTH_INTROSPECT_CLIENT_SECRET=your-resource-server-client-secret \
MCP_HTTP_PORT=4104 \
node dist/build/http.mjs
```

Two variables carry this deployment's identity, and both default to production:

| Variable             | What it sets                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `AIR_API_URL`        | The upstream API **and** the protected-resource metadata origin advertised in the `401`         |
| `MCP_OAUTH_RESOURCE` | This server's own public URL, which access tokens must name as their audience                  |

Set both when running anywhere other than production. Left at their defaults, a
staging or dev server sends clients to production for OAuth discovery and then
rejects the tokens they come back with, because the audience never matches.

Deploy notes, Angie, and systemd units live in [`infra/`](./infra/).

Remote clients authorize with OAuth 2.0 against `https://api.air.thalus.ai` (authorization code + PKCE S256, dynamic client registration). Discovery starts from the `401` on `/mcp`, whose `WWW-Authenticate` header points at `https://api.air.thalus.ai/.well-known/oauth-protected-resource`. Access tokens must carry `https://mcp.air.thalus.ai/mcp` as their audience.

End-user setup: [Remote MCP server (OAuth)](https://air.thalus.ai/docs/guides/mcp-remote-oauth).

## Starting without an account

> **The hosted server has not shipped this yet.** Everything below is live on **stdio** today. The remote endpoint at `mcp.air.thalus.ai` still asks for authorization before anything, and gains the flow described here with its next deploy.

**Both transports** support this. On stdio the server boots in setup mode with no credential; on the remote transport the connector can be added without a token. These tools need no credential:

| Tool                                     | What it does                                                      |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `air_create_account`                     | Collects name, email, organization, code and terms — in a form or a dialog |
| `air_submit_feedback`                    | Sends feedback to Thalus — you are asked for a reply address when you have no account |
| `air_signup_send_code`, `air_signup_verify_code` | The form's own callbacks; hidden from the model                |
| `air_sign_out`                           | stdio only; clears the stored credential                           |

On the remote transport, everything else is protected. The first time the assistant calls a protected tool without a token, the server answers **HTTP 401** with a `WWW-Authenticate` challenge, and the client shows its inline **Connect** card. You authorize in a popup, the client retries the same call automatically, and the conversation carries on — nothing is lost. This is [lazy authentication](https://claude.com/docs/connectors/building/lazy-authentication); the alternative, refusing every request until you sign in first, is what made an agent-first signup impossible.

Creating an account in chat:

1. Ask the assistant to create an AIR account. It calls `air_create_account`.
2. Type your name, work email and organization. **You** type them — the model supplies nothing, and what you type does not enter its context.
3. Enter the code emailed to you, tick the terms box, and submit. The terms tick is read from the checkbox only; the model cannot set it, and the API refuses without it.
4. On the remote transport, press the sign-in button: it gives your browser a session, so the OAuth consent screen appears directly next time. On stdio there is nothing more to do — the key is already stored and the full tool set is available.

Your organization starts on the Free plan with one assessment credit per 30 days. Use `air_get_credit_balance` to see where you stand and `air_request_credits` to ask for more.

Neither feedback nor a credit request asks the assistant for an email address. Thalus replies to the **organization owner**, or to an address you type yourself in the confirmation dialog. Only the unauthenticated case needs one from you, because there is no account to reply to.

### What your client supports

`air_create_account` uses the richest input your client offers:

| Client capability                            | What happens                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| [MCP Apps](https://modelcontextprotocol.io/) (**Claude Code**, Claude, VS Code) | A form renders in the conversation. Fields never reach the model at all. |
| Elicitation only                             | Two dialogs: details, then the code and the terms checkbox.              |
| Neither                                      | The portal signup link, and it stops. It will not ask the model for your details. |

## Credentials

The stdio server resolves a credential in this order, and **starts either way**:

| Order | Source                                      | Notes                                                              |
| ----- | ------------------------------------------- | -------------------------------------------------------------------- |
| 1     | `AIR_API_KEY`                               | Set in your MCP client config. Wins over anything on disk.         |
| 2     | `~/.air/credentials.json`                   | Written by `air_create_account`. Override with `AIR_CREDENTIALS_PATH`. |
| 3     | none → **setup mode**                       | Only the tools that work without an account are offered.           |

**The stored file holds a bearer key**, so it is written with mode `0600` (owner read/write only) in a directory created `0700`. The key is written straight to that file and **never returned in a tool result**, so it does not end up in your conversation transcript or your client's logs. Alongside it the file records the API URL, org slug, domain pid, domain slug and creation time, so the server can answer "which account is this?" without a network call.

A damaged or unreadable credential file is reported on stderr and treated as no credential, so the server still starts in setup mode; `air_sign_out` removes the file.

### Setup mode

With no credential, the server offers five tools — `air_create_account`, `air_submit_feedback`, `air_sign_out`, and the signup form's two callbacks. Everything else is registered but disabled, so it is not offered and cannot be called.

The moment an account is created, the key is stored and the full surface is enabled, and the server emits `tools/list_changed`. **No restart is needed** — the client sees the tool list grow in place.

### Signing out

`air_sign_out` deletes `~/.air/credentials.json` and returns to setup mode. The account itself is untouched; you can sign back in with the same key or create another account.

**Signing out forgets the key on this machine — it does not revoke it.** The key keeps working anywhere else it is held. If the machine was lost, shared, or is no longer yours, revoke the key itself in the [AIR portal](https://air.thalus.ai): open your domain → **API Keys**, find the key for the MCP service account, and revoke it there.

If your key came from **`AIR_API_KEY`**, there is no file to delete and the tool says so rather than reporting a success: remove the variable from your client configuration and restart. If a stored file also exists, the result tells you that too, since that file would take over once the variable is gone.

## Configuration

For stdio you can set **`AIR_API_KEY`**, or create an account in the conversation and let the server store one. The server connects to production AIR automatically.

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
| **Claude Code**    | `.mcp.json` or `~/.claude.json`                                        | Or: `claude mcp add --env AIR_API_KEY=… --transport stdio air -- npx -y @thalus-ai/mcp-air@1.3.0` — [docs](https://code.claude.com/docs/en/mcp) |
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

### Tools (35 stdio / 32 remote)

| Category        | Tools                                                                                                                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Discovery**   | `air_list_domains`, `air_get_domain`, `air_list_projects`, `air_get_project`, `air_create_project`, `air_search`                                                                                                            |
| **Documents**   | `air_list_documents`, `air_get_document_download_url`, `air_list_artifacts`, `air_get_artifact_text`, `air_upload_document_init`, `air_upload_document_complete`                                                                  |
| **Assessments** | `air_list_assessments`, `air_get_assessment`, `air_get_assessment_report`, `air_get_assessment_summary`, `air_list_open_facts`, `air_submit_fact_answers`, `air_get_assessment_stages`, `air_get_assessment_input_artifacts`, `air_create_assessment_draft`, `air_start_assessment`, `air_retry_assessment` |
| **Portfolio**   | `air_get_domain_portfolio`                                                                                                                                                                                                  |
| **Composites**  | `air_wait_for_document_extraction`, `air_wait_for_assessment`, `air_run_assessment_from_file`†, `air_run_full_assessment_pipeline`†                                                                                         |
| **Account**     | `air_create_account`‡, `air_signup_send_code`‡§, `air_signup_verify_code`‡§, `air_sign_out`¶                                                                                                                                |
| **Support**     | `air_submit_feedback`‡, `air_request_credits`, `air_get_credit_balance`                                                                                                                                                     |

† stdio only  ‡ needs no credential  § form-only, hidden from the model  ¶ stdio only — it exists where a credential file can

The stdio count is one higher than the remote count because `air_sign_out` manages the local credential file, and the hosted transport has none: there, OAuth is the credential.

`air_wait_for_*` block with exponential backoff until the resource is ready or `timeoutMs` elapses, then return `ready: false` with the last observed status — call again with the same pid to keep waiting. Pipeline tools (`air_run_assessment_from_file`, `air_run_full_assessment_pipeline`) use the [MCP Tasks extension](https://modelcontextprotocol.io/extensions/tasks/overview) and return a task handle immediately, so they require a Tasks-capable client.

### Surface differences: stdio vs remote

| Local capability                                   | Remote equivalent                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Read a local file (`air_run_assessment_from_file`) | `air_upload_document_init` → PUT → `air_upload_document_complete`                 |
| MCP Tasks (`air_run_full_assessment_pipeline`)     | `air_start_assessment` → `air_wait_for_assessment` → `air_get_assessment_summary` |

Uploads work the same on both surfaces, through the presigned pair. The client must be able to reach the storage host to perform the PUT.

Remote waits are capped at 240s per call (hosted clients abort a tool call at 300s); stdio keeps the longer 10 / 30 minute ceilings.

### Uploading to the presigned URL

The presigned URL signs `content-type` and `host` only. Send the file bytes with the same `contentType` you passed to `air_upload_document_init` and nothing else:

```bash
curl -X PUT --upload-file ./model-card.pdf \
  -H 'Content-Type: application/pdf' \
  "$UPLOAD_URL"
```

Do not add `x-amz-*` headers. AWS SDKs and `aws s3 cp` attach `x-amz-checksum-crc32` and `x-amz-sdk-checksum-algorithm` by default; those are not part of the signature and the PUT fails with `SignatureDoesNotMatch`. With boto3, set `AWS_REQUEST_CHECKSUM_CALCULATION=when_required`, or use a plain HTTP client.

### Reading a large report

A full report can run past what a single tool result can carry, so `air_get_assessment_report` degrades in steps rather than getting truncated:

| Call                                                          | You get                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `air_get_assessment_summary`                                  | Overview, quality, EU AI Act tier, and per-section counts        |
| `air_get_assessment_report` (no `section`)                    | The whole report, or a section index if it doesn't fit           |
| `air_get_assessment_report` + `section`                       | That one slice                                                   |
| `air_get_assessment_report` + `section` + `offset` / `limit`  | A page of a list section, with `totalItems` and `nextOffset`     |
| `air://assessments/{pid}/report` resource                     | The raw full report, unsliced                                    |

The section index lists every section with its serialized size and item count, so a caller that overflows can pick deliberately instead of guessing. List sections page automatically: ask for `riskRegister` and you get as many entries as fit plus a `nextOffset` to resume from.

### Resources (3 templates)

| URI pattern                                | Description                      |
| ------------------------------------------ | -------------------------------- |
| `air://assessments/{assessmentPid}/report` | Completed assessment report JSON |
| `air://assessments/{assessmentPid}/stages` | Stage execution log              |
| `air://projects/{projectPid}/assessments`  | Assessments for a project        |

### App resource (1)

| URI                          | Description                                                          |
| ---------------------------- | -------------------------------------------------------------------- |
| `ui://air/signup-form.html`  | The in-chat signup form, served as `text/html;profile=mcp-app`       |

### Prompts (3)

| Name                       | Purpose                                 |
| -------------------------- | --------------------------------------- |
| `run-assessment-workflow`  | End-to-end assessment workflow guidance |
| `review-assessment-report` | Structured report review                |
| `explore-portfolio`        | Domain portfolio exploration            |

## Typical workflow

0. No account yet? `air_create_account` (remote transport) — see [Starting without an account](#starting-without-an-account)
1. `air_list_domains` → obtain `domainPid`
2. `air_list_projects` → obtain `projectPid` (or `air_create_project` with **fullPipeline**)
3. Upload evidence: `air_run_assessment_from_file` (stdio), or `air_upload_document_init` → PUT → `air_upload_document_complete` → `air_wait_for_document_extraction`
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
- Pin the package version in production (`@thalus-ai/mcp-air@1.3.0`) rather than floating `@latest`.
- Use least-privilege API key scopes. Write tools (`air_start_assessment`, uploads) consume organization credits.
- Never commit API keys. Use `env` or `envFile` in MCP client configuration.

## Privacy

The AIR cloud (Thalus) processes the documents, project data, and account information you submit through this server in order to run assessments and generate reports. See the [Privacy Policy](https://air.thalus.ai/privacy) for details on data collection, usage and storage, third-party sharing, and retention. Contact `privacy@thalus.ai` with privacy questions.

## License

MIT — see [LICENSE](./LICENSE).

## Related repositories

- [VericyIO/mcp-air](https://github.com/VericyIO/mcp-air) — this server (source)
- [VericyIO/thalus-air-skills](https://github.com/VericyIO/thalus-air-skills) — optional agent skills for MCP workflows

Maintainer notes (build, publish, constants sync): see [AGENTS.md](./AGENTS.md).
