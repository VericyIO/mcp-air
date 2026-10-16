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

const writeHint = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
} as const

export const registerDecisionTools = (server: McpServer, api: IntegratorApiClient) => {
  server.registerTool(
    'air_list_project_decisions',
    {
      title: MCP_AIR_TOOL_TITLES.air_list_project_decisions,
      description:
        'List saved choices for a project, each judged against assessmentPid. posture is stands, conflicts, or settled. Requires projects:read.',
      inputSchema: {
        projectPid: z.string(),
        assessmentPid: z.string(),
      },
      annotations: { ...readOnly, title: MCP_AIR_TOOL_TITLES.air_list_project_decisions },
    },
    async ({ projectPid, assessmentPid }) => {
      try {
        return toolJsonResult(await api.listProjectDecisions(projectPid, assessmentPid))
      } catch (error) {
        return toolErrorResult(error, 'air_list_project_decisions')
      }
    },
  )

  server.registerTool(
    'air_record_project_decision',
    {
      title: MCP_AIR_TOOL_TITLES.air_record_project_decision,
      description:
        'Save a developer choice on the project. not_applicable covers a whole themeId. accept_gap covers one controlId and requires it. A later choice for the same theme or control replaces the earlier one. Requires projects:write.',
      inputSchema: {
        projectPid: z.string(),
        assessmentPid: z.string(),
        choice: z.enum(['not_applicable', 'accept_gap']),
        themeId: z.string(),
        controlId: z.string().optional(),
        reason: z.string().min(1),
      },
      annotations: { ...writeHint, title: MCP_AIR_TOOL_TITLES.air_record_project_decision },
    },
    async ({ projectPid, assessmentPid, choice, themeId, controlId, reason }) => {
      try {
        return toolJsonResult(
          await api.recordProjectDecision(projectPid, {
            assessmentPid,
            choice,
            themeId,
            ...(controlId !== undefined ? { controlId } : {}),
            reason,
          }),
        )
      } catch (error) {
        return toolErrorResult(error, 'air_record_project_decision')
      }
    },
  )
}
