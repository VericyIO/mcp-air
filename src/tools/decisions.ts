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
        'List saved choices for a project, each judged against assessmentPid. posture: stands (no later scan disagrees), conflicts (a later scan raised the topic again; show the saved sentence and ask again), settled (the accepted gap is no longer open). Requires projects:read.',
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
        "Save a developer choice on the project, in the person's own words. Ask them first. Use not_applicable when the whole topic (themeId) does not apply to this system: later scans keep that topic and its gaps quiet until one raises the topic again. Use accept_gap when the topic applies but the person accepts one missing control (controlId required): the gap stays listed with the saved sentence beside it. The scan the choice is recorded on does not judge it; later scans do. A later choice for the same theme or control replaces the earlier one. Requires projects:write.",
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
      if (choice === 'accept_gap' && controlId === undefined) {
        return toolErrorResult(
          new Error('accept_gap needs the controlId of the one gap being accepted.'),
          'air_record_project_decision',
        )
      }
      if (choice === 'not_applicable' && controlId !== undefined) {
        return toolErrorResult(
          new Error('not_applicable covers the whole theme; leave controlId out.'),
          'air_record_project_decision',
        )
      }
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
