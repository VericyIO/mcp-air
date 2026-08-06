import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { IntegratorApiClient } from '../client/integrator-api.js'
import { toolErrorResult, toolJsonResult } from '../errors.js'
import { MCP_AIR_TOOL_TITLES } from '../tool-titles.js'

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const

export const registerPortfolioTools = (server: McpServer, api: IntegratorApiClient) => {
  server.registerTool(
    'air_get_domain_portfolio',
    {
      title: MCP_AIR_TOOL_TITLES.air_get_domain_portfolio,
      description:
        'Domain-level portfolio dashboard. Requires portfolio:read (fullPipeline preset). Domain-scoped API keys only work for their bound domain.',
      inputSchema: {
        orgSlug: z.string(),
        domainSlug: z.string(),
      },
      annotations: { ...readOnly, title: MCP_AIR_TOOL_TITLES.air_get_domain_portfolio },
    },
    async ({ orgSlug, domainSlug }) => {
      try {
        return toolJsonResult(await api.domainPortfolio(orgSlug, domainSlug))
      } catch (error) {
        return toolErrorResult(error, 'air_get_domain_portfolio')
      }
    },
  )
}
