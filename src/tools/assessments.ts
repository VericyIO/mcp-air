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
  destructiveHint: false,
  openWorldHint: true,
} as const

export const registerAssessmentTools = (server: McpServer, api: IntegratorApiClient) => {
  server.registerTool(
    'air_list_assessments',
    {
      title: MCP_AIR_TOOL_TITLES.air_list_assessments,
      description: 'List assessment summaries for a project. Requires assessments:read.',
      inputSchema: { projectPid: z.string() },
      annotations: readOnly,
    },
    async ({ projectPid }) => {
      try {
        return toolJsonResult(await api.listAssessments(projectPid))
      } catch (error) {
        return toolErrorResult(error, 'air_list_assessments')
      }
    },
  )

  server.registerTool(
    'air_get_assessment',
    {
      title: MCP_AIR_TOOL_TITLES.air_get_assessment,
      description:
        'Get assessment detail including status and workflowRunId. Requires assessments:read.',
      inputSchema: { assessmentPid: z.string().describe('Assessment pid (pasm_*)') },
      annotations: readOnly,
    },
    async ({ assessmentPid }) => {
      try {
        return toolJsonResult(await api.getAssessment(assessmentPid))
      } catch (error) {
        return toolErrorResult(error, 'air_get_assessment')
      }
    },
  )

  server.registerTool(
    'air_get_assessment_report',
    {
      title: MCP_AIR_TOOL_TITLES.air_get_assessment_report,
      description:
        'Fetch the structured risk assessment report JSON for a completed run. Requires assessments:read.',
      inputSchema: { assessmentPid: z.string() },
      annotations: readOnly,
    },
    async ({ assessmentPid }) => {
      try {
        return toolJsonResult(await api.getAssessmentReport(assessmentPid))
      } catch (error) {
        return toolErrorResult(error, 'air_get_assessment_report')
      }
    },
  )

  server.registerTool(
    'air_get_assessment_stages',
    {
      title: MCP_AIR_TOOL_TITLES.air_get_assessment_stages,
      description: 'List per-stage checkpoint logs for an assessment run. Requires assessments:read.',
      inputSchema: { assessmentPid: z.string() },
      annotations: readOnly,
    },
    async ({ assessmentPid }) => {
      try {
        return toolJsonResult(await api.listAssessmentStages(assessmentPid))
      } catch (error) {
        return toolErrorResult(error, 'air_get_assessment_stages')
      }
    },
  )

  server.registerTool(
    'air_get_assessment_input_artifacts',
    {
      title: MCP_AIR_TOOL_TITLES.air_get_assessment_input_artifacts,
      description:
        'List artifacts used as inputs when the assessment report was generated. Requires assessments:read.',
      inputSchema: { assessmentPid: z.string() },
      annotations: readOnly,
    },
    async ({ assessmentPid }) => {
      try {
        return toolJsonResult(await api.listAssessmentInputArtifacts(assessmentPid))
      } catch (error) {
        return toolErrorResult(error, 'air_get_assessment_input_artifacts')
      }
    },
  )

  server.registerTool(
    'air_create_assessment_draft',
    {
      title: MCP_AIR_TOOL_TITLES.air_create_assessment_draft,
      description: 'Create an assessment draft without starting the pipeline. Requires assessments:write.',
      inputSchema: {
        projectPid: z.string(),
        name: z.string().describe('Display name for the assessment'),
        artifactPids: z.array(z.string()).min(1).max(5).describe('Up to five artifact pids'),
      },
      annotations: writeHint,
    },
    async ({ projectPid, name, artifactPids }) => {
      try {
        return toolJsonResult(await api.createAssessmentDraft(projectPid, name, artifactPids))
      } catch (error) {
        return toolErrorResult(error, 'air_create_assessment_draft')
      }
    },
  )

  server.registerTool(
    'air_start_assessment',
    {
      title: MCP_AIR_TOOL_TITLES.air_start_assessment,
      description:
        'Start a risk assessment on a project. Consumes org credits and dispatches the risk pipeline. Requires assessments:write. Returns assessmentPid.',
      inputSchema: {
        projectPid: z.string(),
        name: z.string().describe('Display name for the run'),
        artifactPids: z
          .array(z.string())
          .min(1)
          .max(5)
          .describe('Artifact pids from air_list_artifacts (max 5)'),
      },
      annotations: writeHint,
    },
    async ({ projectPid, name, artifactPids }) => {
      try {
        return toolJsonResult(await api.startAssessment(projectPid, name, artifactPids))
      } catch (error) {
        return toolErrorResult(error, 'air_start_assessment')
      }
    },
  )

  server.registerTool(
    'air_retry_assessment',
    {
      title: MCP_AIR_TOOL_TITLES.air_retry_assessment,
      description:
        'Retry a failed assessment from the last completed stage. Requires assessments:write and consumes credits.',
      inputSchema: { assessmentPid: z.string() },
      annotations: writeHint,
    },
    async ({ assessmentPid }) => {
      try {
        return toolJsonResult(await api.retryAssessment(assessmentPid))
      } catch (error) {
        return toolErrorResult(error, 'air_retry_assessment')
      }
    },
  )
}
