import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { IntegratorApiClient } from '../client/integrator-api.js'
import { toolErrorResult, toolJsonResult } from '../errors.js'

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
  server.tool(
    'air_list_assessments',
    'List assessment summaries for a project. Requires assessments:read.',
    { projectPid: z.string() },
    readOnly,
    async ({ projectPid }) => {
      try {
        return toolJsonResult(await api.listAssessments(projectPid))
      } catch (error) {
        return toolErrorResult(error, 'air_list_assessments')
      }
    },
  )

  server.tool(
    'air_get_assessment',
    'Get assessment detail including status and workflowRunId. Requires assessments:read.',
    { assessmentPid: z.string().describe('Assessment pid (pasm_*)') },
    readOnly,
    async ({ assessmentPid }) => {
      try {
        return toolJsonResult(await api.getAssessment(assessmentPid))
      } catch (error) {
        return toolErrorResult(error, 'air_get_assessment')
      }
    },
  )

  server.tool(
    'air_get_assessment_report',
    'Fetch the structured risk assessment report JSON for a completed run. Requires assessments:read.',
    { assessmentPid: z.string() },
    readOnly,
    async ({ assessmentPid }) => {
      try {
        return toolJsonResult(await api.getAssessmentReport(assessmentPid))
      } catch (error) {
        return toolErrorResult(error, 'air_get_assessment_report')
      }
    },
  )

  server.tool(
    'air_get_assessment_stages',
    'List per-stage checkpoint logs for an assessment run. Requires assessments:read.',
    { assessmentPid: z.string() },
    readOnly,
    async ({ assessmentPid }) => {
      try {
        return toolJsonResult(await api.listAssessmentStages(assessmentPid))
      } catch (error) {
        return toolErrorResult(error, 'air_get_assessment_stages')
      }
    },
  )

  server.tool(
    'air_get_assessment_input_artifacts',
    'List artifacts used as inputs when the assessment report was generated. Requires assessments:read.',
    { assessmentPid: z.string() },
    readOnly,
    async ({ assessmentPid }) => {
      try {
        return toolJsonResult(await api.listAssessmentInputArtifacts(assessmentPid))
      } catch (error) {
        return toolErrorResult(error, 'air_get_assessment_input_artifacts')
      }
    },
  )

  server.tool(
    'air_create_assessment_draft',
    'Create an assessment draft without starting the pipeline. Requires assessments:write.',
    {
      projectPid: z.string(),
      name: z.string().describe('Display name for the assessment'),
      artifactPids: z.array(z.string()).min(1).max(5).describe('Up to five artifact pids'),
    },
    writeHint,
    async ({ projectPid, name, artifactPids }) => {
      try {
        return toolJsonResult(await api.createAssessmentDraft(projectPid, name, artifactPids))
      } catch (error) {
        return toolErrorResult(error, 'air_create_assessment_draft')
      }
    },
  )

  server.tool(
    'air_start_assessment',
    'Start a risk assessment on a project. Consumes org credits and dispatches the risk pipeline. Requires assessments:write. Returns assessmentPid.',
    {
      projectPid: z.string(),
      name: z.string().describe('Display name for the run'),
      artifactPids: z
        .array(z.string())
        .min(1)
        .max(5)
        .describe('Artifact pids from air_list_artifacts (max 5)'),
    },
    writeHint,
    async ({ projectPid, name, artifactPids }) => {
      try {
        return toolJsonResult(await api.startAssessment(projectPid, name, artifactPids))
      } catch (error) {
        return toolErrorResult(error, 'air_start_assessment')
      }
    },
  )

  server.tool(
    'air_retry_assessment',
    'Retry a failed assessment from the last completed stage. Requires assessments:write and consumes credits.',
    { assessmentPid: z.string() },
    writeHint,
    async ({ assessmentPid }) => {
      try {
        return toolJsonResult(await api.retryAssessment(assessmentPid))
      } catch (error) {
        return toolErrorResult(error, 'air_retry_assessment')
      }
    },
  )
}
