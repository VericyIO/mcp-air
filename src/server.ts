import { InMemoryTaskStore } from '@modelcontextprotocol/sdk/experimental/tasks'
import type { TaskStore } from '@modelcontextprotocol/sdk/experimental/tasks/interfaces.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { createIntegratorApiClient, type IntegratorApiClient } from './client/integrator-api.js'
import {
  MCP_AIR_SERVER_NAME,
  MCP_AIR_SERVER_TITLE,
  MCP_AIR_SERVER_VERSION,
  type McpAirConfig,
} from './config.js'
import { registerAssessmentPrompts } from './prompts/assessment-workflow.js'
import { registerReportResources } from './resources/reports.js'
import { registerAccountTools } from './tools/account.js'
import { registerAssessmentTools } from './tools/assessments.js'
import { registerCompositeTools } from './tools/composites.js'
import { registerDiscoverTools } from './tools/discover.js'
import { registerDocumentTools } from './tools/documents.js'
import { registerPortfolioTools } from './tools/portfolio.js'
import { registerSupportTools } from './tools/support.js'
import type { StdioSession } from './session.js'
import type { McpAirSurface } from './surface.js'

export type CreateAirMcpServerOptions = {
  readonly surface?: McpAirSurface
  readonly taskStore?: TaskStore
  readonly api?: IntegratorApiClient
  /**
   * stdio only. Present when the server may boot without a credential: it owns
   * the credential file and switches the tool surface between setup mode and
   * the full set.
   */
  readonly session?: StdioSession
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
      title: MCP_AIR_SERVER_TITLE,
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

  // In setup mode every registration is captured, so the credential-dependent
  // tools can be disabled now and enabled the moment an account exists.
  const target = options.session === undefined ? server : options.session.record(server)

  registerDiscoverTools(target, api)
  registerDocumentTools(target, api)
  registerAssessmentTools(target, api)
  registerPortfolioTools(target, api)
  registerSupportTools(target, api)
  registerAccountTools(target, api, options.session)
  registerCompositeTools(target, api, surface)
  registerReportResources(target, api)
  registerAssessmentPrompts(target)

  options.session?.applyToolState()

  return server
}
