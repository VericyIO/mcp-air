/**
 * Integrator constants for MCP error hints and default API origin.
 * Keep in sync with thalus-apps domain config (authoritative):
 * - https://github.com/VericyIO/thalus-apps/blob/main/packages/domain/src/air/config/api-key-scopes.ts
 * - https://github.com/VericyIO/thalus-apps/blob/main/packages/domain/src/air/config/public-docs.ts
 * Drift is checked from thalus-apps CI via scripts/verify-mcp-air-constants.mjs.
 */

/** Production API origin shown to integrators. Mirrors AIR_PUBLIC_API_ORIGIN. */
export const MCP_AIR_PUBLIC_API_ORIGIN = 'https://api.air.thalus.ai' as const

export const MCP_INTEGRATOR_API_KEY_SCOPE_PROJECTS_READ = 'projects:read' as const
export const MCP_INTEGRATOR_API_KEY_SCOPE_PROJECTS_WRITE = 'projects:write' as const
export const MCP_INTEGRATOR_API_KEY_SCOPE_ASSESSMENTS_READ = 'assessments:read' as const
export const MCP_INTEGRATOR_API_KEY_SCOPE_ASSESSMENTS_WRITE = 'assessments:write' as const
export const MCP_INTEGRATOR_API_KEY_SCOPE_DOMAINS_READ = 'domains:read' as const
export const MCP_INTEGRATOR_API_KEY_SCOPE_DOMAINS_WRITE = 'domains:write' as const
export const MCP_INTEGRATOR_API_KEY_SCOPE_PORTFOLIO_READ = 'portfolio:read' as const
export const MCP_INTEGRATOR_API_KEY_SCOPE_SEARCH_READ = 'search:read' as const
export const MCP_INTEGRATOR_API_KEY_SCOPE_INTEGRATIONS_FULL = 'integrations:full' as const

/** MCP resource URI template for a completed assessment report. */
export const MCP_AIR_ASSESSMENT_REPORT_URI_TEMPLATE =
  'air://assessments/{assessmentPid}/report' as const

/** MCP resource URI template for assessment stage logs. */
export const MCP_AIR_ASSESSMENT_STAGES_URI_TEMPLATE =
  'air://assessments/{assessmentPid}/stages' as const

/** MCP resource URI template for a project's assessment list. */
export const MCP_AIR_PROJECT_ASSESSMENTS_URI_TEMPLATE =
  'air://projects/{projectPid}/assessments' as const
