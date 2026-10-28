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
export const MCP_AIR_SERVER_VERSION = '1.5.0' as const

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

export const MCP_AIR_SUMMARY_TOP_RISKS = 5 as const

/** Input default for `air_upload_document`. Omitted contentType means markdown text, not a hidden failure. */
export const MCP_AIR_DEFAULT_UPLOAD_CONTENT_TYPE = 'text/markdown' as const

/** Individual questions on one form page. The checklist counts as one. */
export const MCP_AIR_FACT_FORM_MAX_QUESTIONS = 10 as const

/**
 * How long one form page may stay open. The SDK default is 60 seconds, which a person reading
 * the checklist can pass; the call then fails while the dialog is still on screen.
 */
export const MCP_AIR_FACT_FORM_TIMEOUT_MS = 30 * 60_000

/** Pages one call may show before it hands back to the agent. */
export const MCP_AIR_FACT_FORM_MAX_PAGES = 6 as const

export const MCP_AIR_FACT_ANSWER_YES = 'yes' as const
export const MCP_AIR_FACT_ANSWER_NO = 'no' as const
export const MCP_AIR_FACT_ANSWER_NOT_SURE = 'not_sure' as const
export const MCP_AIR_FACT_ANSWER_NONE = 'none' as const

export const MCP_AIR_FACT_ANSWER_YES_LABEL = 'Yes' as const
export const MCP_AIR_FACT_ANSWER_NO_LABEL = 'No' as const
export const MCP_AIR_FACT_ANSWER_NOT_SURE_LABEL = 'Not sure' as const
export const MCP_AIR_FACT_ANSWER_NONE_LABEL = 'None of these' as const

/** Title of the choice row. The full question is the dialog text, because a long row is cut. */
export const MCP_AIR_ANSWER_FIELD_TITLE = 'Answer' as const

export const MCP_AIR_NO_OPEN_QUESTIONS_NOTE = 'No open questions. The tier is final.' as const

export const MCP_AIR_FACT_FORM_JUSTIFICATION = 'Answered in the AIR question form.' as const

export const MCP_AIR_MORE_QUESTIONS_NEXT_STEP =
  'More questions are open, and their answers can still change the tier. Call air_ask_open_facts again with the same skipFactPaths.' as const

export const MCP_AIR_FACT_FORM_DECLINED_NOTE =
  'The person closed the form. Answers given before that are saved. Do not ask these questions again unless they ask.' as const

export const MCP_AIR_STILL_OPEN_NOTE =
  'The person is not sure about these. Do not ask them again in this conversation. Say that the tier is not final until they are answered, and what each one decides.' as const

export const MCP_AIR_NO_FORM_NEXT_STEP =
  'This client cannot show a form. Ask each question in chat, in order, using the question and help text. Offer the options by label, and add "Not sure". For a list, also offer "None of these". Then call air_submit_fact_answers. Yes, No and Not sure are true, false and null.' as const

export const MCP_AIR_ASK_OPEN_FACTS_DESCRIPTION =
  'Ask the person the open EU AI Act questions one at a time. Each dialog shows the full question, then Yes, No and Not sure, or the labelled options. Saves each answer and re-checks the tier, until no question is open or every open one is "Not sure". proposedAnswers may only cover facts marked suggestFromCode, which the code can show; never suggest what the system is used for or whom it affects. Pass back notSureFactPaths from the last call as skipFactPaths. Answers are kept on the project for later scans. Requires assessments:write.' as const

export const MCP_AIR_ASK_SCREENING_QUESTIONS_DESCRIPTION =
  'Before a scan, ask the person each EU AI Act screening question in its own dialog, with the full question and Yes, No and Not sure, or the labelled options. Facts the project already holds an answer for are left out. Returns the answers to hold: after air_start_assessment, send them with air_save_prepared_answers. It saves nothing itself. Requires projects:read.' as const

export const MCP_AIR_SCREENING_DONE_NOTE =
  'The project already holds an answer for every checklist fact. Ask nothing.' as const

export const MCP_AIR_SCREENING_DECLINED_NOTE =
  'The person closed a question. Nothing answered after that is held. Continue without those answers; the scan asks after it reads the documents.' as const

export const MCP_AIR_SCREENING_HOLD_NEXT_STEP =
  'Hold these answers. Write each yes answer into the project summary as a declared line. After air_start_assessment returns, send factPath and value of each answer with air_save_prepared_answers.' as const

export const MCP_AIR_SCREENING_NO_FORM_NEXT_STEP =
  'This client cannot show a form. Ask each question in chat, in order, using its question and help text. Offer Yes, No and Not sure, or the options by label plus "None of these" and "Not sure". Hold the answers and send them with air_save_prepared_answers after air_start_assessment.' as const

export const MCP_AIR_LIST_OPEN_FACTS_DESCRIPTION =
  'List the open EU AI Act questions for an assessment: only facts whose answer can still change the tier and that are worth asking now, checklist facts first. screeningGroups are the checklist lines that still hold an open fact. Each item has question (ask it as written), help (one line on why it matters) and, for list facts, options (show the labels, send the values). Boolean facts take true, false, or null for "Not sure"; list facts take option values, or [] for none. answerConflicts are earlier answers that this scan read differently, with the scan\'s excerpts. Never show factPath, description or a raw null to the person. Prefer air_ask_open_facts when the client can show forms. Requires assessments:read.' as const

export const MCP_AIR_UPLOAD_DOCUMENT_DESCRIPTION =
  'Upload a text document, such as the scan summary, to a project in one call: start the upload, send the content, finish it, and wait until AIR has read it. Returns the source and its status. For binary files, use air_upload_document_init and the related tools. Requires projects:write.' as const

export const MCP_AIR_SUMMARY_TIER_SENTENCE =
  'the EU AI Act tier (value, name, description, and final: true when no open question can change it) with the names of the matched criteria' as const

export const MCP_AIR_SUMMARY_TOP_RISKS_SENTENCE =
  'topRisks lists the first few risk-register items in short form; fetch the riskRegister section of air_get_assessment_report for the full list.' as const

export const factSuggestionLine = (answer: string, reason: string): string =>
  `Suggested from your code: ${answer} (${reason})`

export const factConflictLine = (
  kept: string,
  scan: string,
  excerpt: string | undefined,
): string =>
  excerpt === undefined
    ? `You answered ${kept} before. This scan read ${scan}.`
    : `You answered ${kept} before. This scan read ${scan}: "${excerpt}"`

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
