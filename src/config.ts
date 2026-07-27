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

/** MCP server semver. */
export const MCP_AIR_SERVER_VERSION = '1.0.0' as const

/** Default page size for list tools when the caller omits `limit`. */
export const MCP_AIR_DEFAULT_LIST_LIMIT = 20 as const

export type McpAirConfig = {
  readonly apiUrl: string
  readonly apiKey: string
}

export const loadMcpAirConfig = (env: NodeJS.ProcessEnv = process.env): McpAirConfig => {
  const apiKey = env[MCP_AIR_API_KEY_ENV]?.trim()
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error(
      `${MCP_AIR_API_KEY_ENV} is required. Create a domain API key in the AIR portal and set it in your MCP config env or envFile.`,
    )
  }

  const rawUrl = env[MCP_AIR_API_URL_ENV]?.trim()
  const apiUrl =
    rawUrl !== undefined && rawUrl.length > 0 ? rawUrl.replace(/\/$/, '') : MCP_AIR_DEFAULT_API_URL

  return { apiUrl, apiKey }
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
