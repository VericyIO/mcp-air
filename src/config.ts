import { MCP_AIR_PUBLIC_API_ORIGIN } from './constants.js'

/** Environment variable for the AIR API bearer key (domain-scoped integrator key). */
export const MCP_AIR_API_KEY_ENV = 'AIR_API_KEY' as const

/** Environment variable for the AIR API base URL (no trailing slash). */
export const MCP_AIR_API_URL_ENV = 'AIR_API_URL' as const

/** Default production API origin when `AIR_API_URL` is unset. */
export const MCP_AIR_DEFAULT_API_URL = MCP_AIR_PUBLIC_API_ORIGIN

/** Poll interval while waiting for document extraction to finish. */
export const MCP_AIR_DOCUMENT_EXTRACTION_POLL_INTERVAL_MS = 3_000 as const

/** Max poll interval for document extraction (async-jobs backoff cap). */
export const MCP_AIR_DOCUMENT_EXTRACTION_POLL_MAX_INTERVAL_MS = 10_000 as const

/** Max wait for document extraction before timing out. */
export const MCP_AIR_DOCUMENT_EXTRACTION_POLL_TIMEOUT_MS = 10 * 60_000

/** Poll interval while waiting for an assessment run to finish. */
export const MCP_AIR_ASSESSMENT_POLL_INTERVAL_MS = 5_000 as const

/** Max poll interval for assessments (async-jobs backoff cap). */
export const MCP_AIR_ASSESSMENT_POLL_MAX_INTERVAL_MS = 10_000 as const

/** Max wait for assessment completion before timing out. */
export const MCP_AIR_ASSESSMENT_POLL_TIMEOUT_MS = 30 * 60_000

/** Multiplier applied between poll attempts until max interval is reached. */
export const MCP_AIR_POLL_BACKOFF_MULTIPLIER = 1.5 as const

/**
 * Longest blocking wait a hosted Claude client may request.
 * Claude.ai and Claude Desktop abort a tool call at 300s, so the wait tools must
 * return a pending result well before that instead of being killed mid-flight.
 */
export const MCP_AIR_REMOTE_WAIT_TIMEOUT_MS = 240_000 as const

/**
 * Serialized-character budget for a single tool result on the remote surface.
 * Claude.ai and Claude Desktop truncate tool results at roughly 150,000 characters;
 * this leaves headroom for the surrounding protocol envelope.
 */
export const MCP_AIR_MAX_TOOL_RESULT_CHARS = 120_000 as const

/** Per-request timeout for integrator API fetch calls. */
export const MCP_AIR_REQUEST_TIMEOUT_MS = 60_000 as const

/** Task TTL for document-extraction wait jobs (timeout + 1 min buffer). */
export const MCP_AIR_DOCUMENT_TASK_TTL_MS = MCP_AIR_DOCUMENT_EXTRACTION_POLL_TIMEOUT_MS + 60_000

/** Task TTL for assessment wait / pipeline jobs (timeout + 1 min buffer). */
export const MCP_AIR_ASSESSMENT_TASK_TTL_MS = MCP_AIR_ASSESSMENT_POLL_TIMEOUT_MS + 60_000

/** MCP Tasks extension identifier (io.modelcontextprotocol/tasks). */
export const MCP_AIR_TASKS_EXTENSION_ID = 'io.modelcontextprotocol/tasks' as const

/** MCP server name passed to the SDK (snake_case service prefix per MCP best practices). */
export const MCP_AIR_SERVER_NAME = 'air-mcp-server' as const

/** Human-readable server display name shown by MCP clients (e.g. Claude's connector UI). */
export const MCP_AIR_SERVER_TITLE = 'Thalus AIR' as const

/** MCP server semver. */
export const MCP_AIR_SERVER_VERSION = '1.3.0' as const

/** Default page size for list tools when the caller omits `limit`. */
export const MCP_AIR_DEFAULT_LIST_LIMIT = 20 as const

/** Where a client without MCP Apps sends the person instead. */
export const MCP_AIR_PORTAL_SIGNUP_URL = 'https://air.thalus.ai/auth/signup' as const

/**
 * The MCP App that collects signup details. Here rather than beside the tool
 * because the transport's public-request gate needs it too, and `surface.ts`
 * importing `tools/account.ts` would close a cycle through `session.ts`.
 */
export const MCP_AIR_SIGNUP_FORM_URI = 'ui://air/signup-form.html' as const

/** Mirrors the API's support limits (`config/support.ts` in thalus-apps). */
export const MCP_AIR_SUPPORT_MESSAGE_MAX_LENGTH = 4_000 as const
export const MCP_AIR_SUPPORT_CREDIT_REQUEST_MAX = 100 as const
export const MCP_AIR_SUPPORT_FEEDBACK_CATEGORIES = [
  'bug',
  'idea',
  'praise',
  'other',
] as const satisfies ReadonlyArray<string>

export type McpAirConfig = {
  readonly apiUrl: string
  /**
   * A fixed key for stdio. The hosted transport passes a resolver, because a
   * session can start anonymous and gain a token when the user connects.
   */
  readonly apiKey: string | (() => string | undefined)
}

export const resolveApiUrl = (env: NodeJS.ProcessEnv = process.env): string => {
  const rawUrl = env[MCP_AIR_API_URL_ENV]?.trim()
  return rawUrl !== undefined && rawUrl.length > 0
    ? rawUrl.replace(/\/$/, '')
    : MCP_AIR_DEFAULT_API_URL
}

/** The key from the environment, if one is set. */
export const envApiKey = (env: NodeJS.ProcessEnv = process.env): string | undefined => {
  const apiKey = env[MCP_AIR_API_KEY_ENV]?.trim()
  return apiKey !== undefined && apiKey.length > 0 ? apiKey : undefined
}

export const loadMcpAirConfig = (env: NodeJS.ProcessEnv = process.env): McpAirConfig => {
  const apiKey = envApiKey(env)
  if (apiKey === undefined) {
    throw new Error(
      `${MCP_AIR_API_KEY_ENV} is required. Create a domain API key in the AIR portal and set it in your MCP config env or envFile.`,
    )
  }

  return { apiUrl: resolveApiUrl(env), apiKey }
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
