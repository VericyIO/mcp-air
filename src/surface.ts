/** MCP tool surface — local stdio vs remote Streamable HTTP. */
export type McpAirSurface = 'local' | 'remote'

/**
 * Tools a caller with no AIR account may invoke. Feedback is public because the
 * most valuable feedback we can get is "your signup failed" — which, by
 * definition, arrives from someone who has no credential.
 */
export const MCP_AIR_PUBLIC_TOOL_NAMES = [
  'air_submit_feedback',
  'air_create_account',
  // App-only and public are different axes. `visibility: ['app']` hides these
  // from the model; the transport must still let them through with no token,
  // because the form calling back has no account yet. Leave them out and the
  // form renders and every submit answers 401.
  'air_signup_send_code',
  'air_signup_verify_code',
] as const satisfies ReadonlyArray<string>

/**
 * JSON-RPC methods that never need a token: the handshake itself, and listing
 * what is on offer. A client must be able to connect and see the tools before
 * it can be asked to authenticate for one of them.
 */
const PUBLIC_JSON_RPC_METHODS = new Set([
  'initialize',
  'notifications/initialized',
  'notifications/cancelled',
  'ping',
  'tools/list',
  'prompts/list',
  'resources/list',
  'resources/templates/list',
])

const PUBLIC_TOOL_NAME_SET = new Set<string>(MCP_AIR_PUBLIC_TOOL_NAMES)

type JsonRpcLike = {
  readonly method?: unknown
  readonly params?: { readonly name?: unknown } | undefined
}

const messageNeedsAuth = (message: JsonRpcLike): boolean => {
  const method = typeof message.method === 'string' ? message.method : undefined
  if (method === undefined) {
    // A response or an unparseable frame carries no method to reason about;
    // treat it as protected rather than guessing it is safe.
    return true
  }

  if (PUBLIC_JSON_RPC_METHODS.has(method)) {
    return false
  }

  if (method === 'tools/call') {
    const name = message.params?.name
    return typeof name !== 'string' || !PUBLIC_TOOL_NAME_SET.has(name)
  }

  return true
}

/**
 * Decide, from the parsed JSON-RPC body alone, whether this request may proceed
 * without a token. The check must happen before the MCP SDK sees the request:
 * a tool handler's return value is always wrapped in a 200, and a 200 with
 * `isError` shows the user text instead of a Connect card.
 *
 * A body with no method (an HTTP GET stream or DELETE teardown) needs no token
 * of its own — the session it belongs to was already gated when it was created.
 */
export const requestNeedsAuthentication = (body: unknown): boolean => {
  if (Array.isArray(body)) {
    return body.some((message) => messageNeedsAuth(message as JsonRpcLike))
  }

  if (typeof body !== 'object' || body === null) {
    return false
  }

  return messageNeedsAuth(body as JsonRpcLike)
}

export const MCP_AIR_REMOTE_TOOL_COUNT = 32 as const

/**
 * Remote surface. Drops the two tools hosted Claude clients cannot drive:
 * - `air_run_assessment_from_file` (no local filesystem)
 * - `air_run_full_assessment_pipeline` (MCP Tasks is a draft extension hosted clients reject)
 */
export const MCP_AIR_REMOTE_TOOL_NAMES = [
  'air_list_domains',
  'air_get_domain',
  'air_list_projects',
  'air_get_project',
  'air_create_project',
  'air_search',
  'air_list_documents',
  'air_get_document_download_url',
  'air_list_artifacts',
  'air_get_artifact_text',
  'air_upload_document_init',
  'air_upload_document_complete',
  'air_list_assessments',
  'air_get_assessment',
  'air_get_assessment_report',
  'air_get_assessment_summary',
  'air_list_open_facts',
  'air_submit_fact_answers',
  'air_get_assessment_stages',
  'air_get_assessment_input_artifacts',
  'air_create_assessment_draft',
  'air_start_assessment',
  'air_retry_assessment',
  'air_get_domain_portfolio',
  'air_wait_for_document_extraction',
  'air_wait_for_assessment',
  'air_submit_feedback',
  'air_request_credits',
  'air_get_credit_balance',
  'air_create_account',
  'air_signup_send_code',
  'air_signup_verify_code',
] as const satisfies ReadonlyArray<string>
