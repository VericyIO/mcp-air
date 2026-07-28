import { InMemoryTaskStore } from '@modelcontextprotocol/sdk/experimental/tasks'
import type { TaskStore } from '@modelcontextprotocol/sdk/experimental/tasks/interfaces.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { createIntegratorApiClient, type IntegratorApiClient } from './client/integrator-api.js'
import { MCP_AIR_SERVER_NAME, MCP_AIR_SERVER_VERSION, type McpAirConfig } from './config.js'
import { registerAssessmentPrompts } from './prompts/assessment-workflow.js'
import { registerReportResources } from './resources/reports.js'
import { registerAssessmentTools } from './tools/assessments.js'
import { registerCompositeTools } from './tools/composites.js'
import { registerDiscoverTools } from './tools/discover.js'
import { registerDocumentTools } from './tools/documents.js'
import { registerPortfolioTools } from './tools/portfolio.js'
import type { McpAirSurface } from './surface.js'

export type CreateAirMcpServerOptions = {
  readonly surface?: McpAirSurface
  readonly taskStore?: TaskStore
  readonly api?: IntegratorApiClient
}

export const createAirMcpServer = (
  config: McpAirConfig,
  options: CreateAirMcpServerOptions = {},
) => {
  const surface = options.surface ?? 'local'
  const api = options.api ?? createIntegratorApiClient(config.apiUrl, config.apiKey)
  const taskStore = options.taskStore ?? new InMemoryTaskStore()

  const server = new McpServer(
    {
      name: MCP_AIR_SERVER_NAME,
      version: MCP_AIR_SERVER_VERSION,
    },
    {
      capabilities: {
        tasks: {
          requests: {
            tools: { call: {} },
          },
        },
      },
      taskStore,
    },
  )

  registerDiscoverTools(server, api)
  registerDocumentTools(server, api)
  registerAssessmentTools(server, api)
  registerPortfolioTools(server, api)
  registerCompositeTools(server, api, surface)
  registerReportResources(server, api)
  registerAssessmentPrompts(server)

  return server
}
