import {
  MCP_INTEGRATOR_API_KEY_SCOPE_ASSESSMENTS_READ,
  MCP_INTEGRATOR_API_KEY_SCOPE_ASSESSMENTS_WRITE,
  MCP_INTEGRATOR_API_KEY_SCOPE_DOMAINS_READ,
  MCP_INTEGRATOR_API_KEY_SCOPE_DOMAINS_WRITE,
  MCP_INTEGRATOR_API_KEY_SCOPE_PORTFOLIO_READ,
  MCP_INTEGRATOR_API_KEY_SCOPE_PROJECTS_READ,
  MCP_INTEGRATOR_API_KEY_SCOPE_PROJECTS_WRITE,
  MCP_INTEGRATOR_API_KEY_SCOPE_SEARCH_READ,
} from './constants.js'

export class IntegratorApiError extends Error {
  readonly status: number
  readonly body: string

  constructor(status: number, body: string) {
    super(formatIntegratorApiError(status, body))
    this.name = 'IntegratorApiError'
    this.status = status
    this.body = body
  }
}

export const formatIntegratorApiError = (status: number, body: string): string => {
  const trimmed = body.trim()
  const detail = trimmed.length > 0 ? trimmed : '(empty response body)'

  switch (status) {
    case 401:
      return `AIR API authentication failed (401). Verify ${'AIR_API_KEY'} is valid and not revoked. See https://air.thalus.ai/docs/public-api/getting-started`
    case 403:
      return `AIR API forbidden (403). Your API key may lack the required scope for this operation. Use assessmentRunner for assess-only flows or fullPipeline for uploads, search, and portfolio. Response: ${detail}`
    case 402:
      return `AIR API billing error (402). Insufficient credits or inactive billing. Response: ${detail}`
    case 404:
      return `AIR API not found (404). Check domainPid, projectPid, or assessmentPid. Response: ${detail}`
    case 409:
      return `AIR API conflict (409). The resource is in a state that rejects this action. Response: ${detail}`
    case 503:
      return `AIR API unavailable (503). Retry shortly. Response: ${detail}`
    default:
      return `AIR API request failed (${status}). Response: ${detail}`
  }
}

const scopeHints: Readonly<Record<string, string>> = {
  air_list_domains: `Requires scope: ${MCP_INTEGRATOR_API_KEY_SCOPE_DOMAINS_READ}`,
  air_get_domain: `Requires scope: ${MCP_INTEGRATOR_API_KEY_SCOPE_DOMAINS_READ}`,
  air_list_projects: `Requires scopes: ${MCP_INTEGRATOR_API_KEY_SCOPE_DOMAINS_READ}, ${MCP_INTEGRATOR_API_KEY_SCOPE_PROJECTS_READ}`,
  air_get_project: `Requires scopes: ${MCP_INTEGRATOR_API_KEY_SCOPE_DOMAINS_READ}, ${MCP_INTEGRATOR_API_KEY_SCOPE_PROJECTS_READ}`,
  air_create_project: `Requires scope: ${MCP_INTEGRATOR_API_KEY_SCOPE_DOMAINS_WRITE} (fullPipeline preset)`,
  air_search: `Requires scope: ${MCP_INTEGRATOR_API_KEY_SCOPE_SEARCH_READ} (fullPipeline preset)`,
  air_list_documents: `Requires scope: ${MCP_INTEGRATOR_API_KEY_SCOPE_PROJECTS_READ}`,
  air_get_document_download_url: `Requires scope: ${MCP_INTEGRATOR_API_KEY_SCOPE_PROJECTS_READ}`,
  air_list_artifacts: `Requires scope: ${MCP_INTEGRATOR_API_KEY_SCOPE_PROJECTS_READ}`,
  air_get_artifact_text: `Requires scope: ${MCP_INTEGRATOR_API_KEY_SCOPE_PROJECTS_READ}`,
  air_upload_document_init: `Requires scope: ${MCP_INTEGRATOR_API_KEY_SCOPE_PROJECTS_WRITE} (fullPipeline preset)`,
  air_upload_document_complete: `Requires scope: ${MCP_INTEGRATOR_API_KEY_SCOPE_PROJECTS_WRITE} (fullPipeline preset)`,
  air_list_assessments: `Requires scope: ${MCP_INTEGRATOR_API_KEY_SCOPE_ASSESSMENTS_READ}`,
  air_get_assessment: `Requires scope: ${MCP_INTEGRATOR_API_KEY_SCOPE_ASSESSMENTS_READ}`,
  air_get_assessment_report: `Requires scope: ${MCP_INTEGRATOR_API_KEY_SCOPE_ASSESSMENTS_READ}`,
  air_get_assessment_stages: `Requires scope: ${MCP_INTEGRATOR_API_KEY_SCOPE_ASSESSMENTS_READ}`,
  air_get_assessment_input_artifacts: `Requires scope: ${MCP_INTEGRATOR_API_KEY_SCOPE_ASSESSMENTS_READ}`,
  air_create_assessment_draft: `Requires scope: ${MCP_INTEGRATOR_API_KEY_SCOPE_ASSESSMENTS_WRITE}`,
  air_start_assessment: `Requires scopes: ${MCP_INTEGRATOR_API_KEY_SCOPE_ASSESSMENTS_WRITE}, ${MCP_INTEGRATOR_API_KEY_SCOPE_PROJECTS_READ} (consumes org credits)`,
  air_retry_assessment: `Requires scope: ${MCP_INTEGRATOR_API_KEY_SCOPE_ASSESSMENTS_WRITE} (consumes org credits)`,
  air_get_domain_portfolio: `Requires scope: ${MCP_INTEGRATOR_API_KEY_SCOPE_PORTFOLIO_READ} (fullPipeline preset); domain API keys only for their bound domain`,
  air_wait_for_document_extraction: `Requires scope: ${MCP_INTEGRATOR_API_KEY_SCOPE_PROJECTS_READ}`,
  air_wait_for_assessment: `Requires scope: ${MCP_INTEGRATOR_API_KEY_SCOPE_ASSESSMENTS_READ}`,
  air_run_assessment_from_file: `Requires scopes: ${MCP_INTEGRATOR_API_KEY_SCOPE_PROJECTS_WRITE}, ${MCP_INTEGRATOR_API_KEY_SCOPE_ASSESSMENTS_WRITE} (fullPipeline preset)`,
  air_run_full_assessment_pipeline: `Requires scopes: ${MCP_INTEGRATOR_API_KEY_SCOPE_ASSESSMENTS_WRITE}, ${MCP_INTEGRATOR_API_KEY_SCOPE_PROJECTS_READ}`,
  'resource:assessment-report': `Requires scope: ${MCP_INTEGRATOR_API_KEY_SCOPE_ASSESSMENTS_READ}`,
  'resource:assessment-stages': `Requires scope: ${MCP_INTEGRATOR_API_KEY_SCOPE_ASSESSMENTS_READ}`,
  'resource:project-assessments': `Requires scope: ${MCP_INTEGRATOR_API_KEY_SCOPE_ASSESSMENTS_READ}`,
}

export const scopeHintForTool = (toolName: string): string =>
  scopeHints[toolName] ??
  'See https://air.thalus.ai/docs/public-api/authentication for scope presets'

export const formatHandlerError = (error: unknown, handlerName: string): string => {
  const hint = scopeHintForTool(handlerName)
  if (error instanceof IntegratorApiError) {
    return `${error.message}\n\nHint: ${hint}`
  }
  if (error instanceof Error) {
    return `${error.message}\n\nHint: ${hint}`
  }
  return `Unknown error: ${String(error)}\n\nHint: ${hint}`
}

export const toolErrorResult = (error: unknown, toolName: string) => ({
  isError: true as const,
  content: [{ type: 'text' as const, text: formatHandlerError(error, toolName) }],
})

export const toolJsonResult = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
})

export const runResourceHandler = async <T>(
  resourceName: string,
  handler: () => Promise<T>,
): Promise<T> => {
  try {
    return await handler()
  } catch (error) {
    throw new Error(formatHandlerError(error, resourceName))
  }
}
