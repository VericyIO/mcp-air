import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { IntegratorApiClient } from '../client/integrator-api.js'
import { toolErrorResult, toolJsonResult } from '../errors.js'

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const

export const registerPortfolioTools = (server: McpServer, api: IntegratorApiClient) => {
  server.tool(
    'air_get_domain_portfolio',
    'Domain-level portfolio dashboard. Requires portfolio:read (fullPipeline preset). Domain-scoped API keys only work for their bound domain.',
    {
      orgSlug: z.string(),
      domainSlug: z.string(),
    },
    readOnly,
    async ({ orgSlug, domainSlug }) => {
      try {
        return toolJsonResult(await api.domainPortfolio(orgSlug, domainSlug))
      } catch (error) {
        return toolErrorResult(error, 'air_get_domain_portfolio')
      }
    },
  )
}
