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

const preparedAnswer = z.object({
  factPath: z.string(),
  value: z.union([z.boolean(), z.array(z.string()), z.null()]),
  justification: z.string().optional(),
})

export const registerScanPrepTools = (server: McpServer, api: IntegratorApiClient) => {
  server.registerTool(
    'air_list_project_fact_answers',
    {
      title: MCP_AIR_TOOL_TITLES.air_list_project_fact_answers,
      description:
        'Active answers already saved on the project. factPath is for the tool call. Do not show factPath to the person. Requires projects:read.',
      inputSchema: { projectPid: z.string() },
      annotations: { ...readOnly, title: MCP_AIR_TOOL_TITLES.air_list_project_fact_answers },
    },
    async ({ projectPid }) => {
      try {
        return toolJsonResult(await api.listProjectFactAnswers(projectPid))
      } catch (error) {
        return toolErrorResult(error, 'air_list_project_fact_answers')
      }
    },
  )

  server.registerTool(
    'air_save_prepared_answers',
    {
      title: MCP_AIR_TOOL_TITLES.air_save_prepared_answers,
      description:
        'Call this right after air_start_assessment, before the facts stage. It does not recompute the tier. The scan applies the answers when it extracts facts. Requires assessments:write.',
      inputSchema: {
        assessmentPid: z.string(),
        answers: z.array(preparedAnswer).min(1),
      },
      annotations: { ...writeHint, title: MCP_AIR_TOOL_TITLES.air_save_prepared_answers },
    },
    async ({ assessmentPid, answers }) => {
      try {
        return toolJsonResult(await api.savePreparedAnswers(assessmentPid, answers))
      } catch (error) {
        return toolErrorResult(error, 'air_save_prepared_answers')
      }
    },
  )

  server.registerTool(
    'air_get_rules_notice',
    {
      title: MCP_AIR_TOOL_TITLES.air_get_rules_notice,
      description:
        'due means the last completed scan used an older catalog or tier method than the one AIR uses now, and the person has not postponed this version. Say so in one line. Do not decide the version yourself. Requires projects:read.',
      inputSchema: { projectPid: z.string() },
      annotations: { ...readOnly, title: MCP_AIR_TOOL_TITLES.air_get_rules_notice },
    },
    async ({ projectPid }) => {
      try {
        return toolJsonResult(await api.getRulesNotice(projectPid))
      } catch (error) {
        return toolErrorResult(error, 'air_get_rules_notice')
      }
    },
  )

  server.registerTool(
    'air_dismiss_rules_notice',
    {
      title: MCP_AIR_TOOL_TITLES.air_dismiss_rules_notice,
      description:
        'The person said later. Stores the current rules version. The notice returns only when AIR moves past it. Requires projects:write.',
      inputSchema: { projectPid: z.string() },
      annotations: { ...writeHint, title: MCP_AIR_TOOL_TITLES.air_dismiss_rules_notice },
    },
    async ({ projectPid }) => {
      try {
        return toolJsonResult(await api.dismissRulesNotice(projectPid))
      } catch (error) {
        return toolErrorResult(error, 'air_dismiss_rules_notice')
      }
    },
  )
}
