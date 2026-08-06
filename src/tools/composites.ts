import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { IntegratorApiClient } from '../client/integrator-api.js'
import {
  MCP_AIR_ASSESSMENT_POLL_INTERVAL_MS,
  MCP_AIR_ASSESSMENT_POLL_TIMEOUT_MS,
  MCP_AIR_ASSESSMENT_TASK_TTL_MS,
  MCP_AIR_DOCUMENT_EXTRACTION_POLL_INTERVAL_MS,
  MCP_AIR_DOCUMENT_EXTRACTION_POLL_TIMEOUT_MS,
  MCP_AIR_REMOTE_WAIT_TIMEOUT_MS,
} from '../config.js'
import { toolErrorResult, toolJsonResult } from '../errors.js'
import { pollUntilAssessmentReady, pollUntilDocumentTerminal } from '../poll.js'
import { standardAirTaskHandlers } from '../tasks/task-handlers.js'
import { runFullAssessmentPipelineTask } from '../tasks/workers.js'
import type { McpAirSurface } from '../surface.js'
import { MCP_AIR_TOOL_TITLES } from '../tool-titles.js'

const writeHint = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
} as const

const readOnlyHint = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const

/**
 * MCP Tasks execution — long-running pipeline tools return a task handle immediately.
 * Local surface only: MCP Tasks is a draft extension and hosted Claude clients reject a
 * `taskSupport: 'required'` tool with -32600, so the remote surface uses
 * air_start_assessment + air_wait_for_assessment instead.
 */
const requiredTaskExecution = {
  taskSupport: 'required' as const,
}

/**
 * Wait tools are plain blocking tools so clients without MCP Tasks support can
 * finish an assessment workflow. Running out of the wait budget is reported as a
 * pending result, not an error, so the agent can simply wait again.
 *
 * Remote (hosted Claude) callers get a shorter ceiling: Claude aborts a tool call at
 * 300s, so a longer wait would be killed client-side instead of returning anything.
 */
export const registerCompositeTools = (
  server: McpServer,
  api: IntegratorApiClient,
  surface: McpAirSurface = 'local',
) => {
  const documentWaitCeilingMs =
    surface === 'remote'
      ? MCP_AIR_REMOTE_WAIT_TIMEOUT_MS
      : MCP_AIR_DOCUMENT_EXTRACTION_POLL_TIMEOUT_MS
  const assessmentWaitCeilingMs =
    surface === 'remote' ? MCP_AIR_REMOTE_WAIT_TIMEOUT_MS : MCP_AIR_ASSESSMENT_POLL_TIMEOUT_MS

  server.registerTool(
    'air_wait_for_document_extraction',
    {
      title: MCP_AIR_TOOL_TITLES.air_wait_for_document_extraction,
      description:
        'Wait until sourcePid reaches connected or error, up to timeoutMs. Uses exponential backoff. Returns ready:false with the last observed status if the wait budget runs out — call again with the same sourcePid to keep waiting. Requires projects:read.',
      inputSchema: {
        projectPid: z.string(),
        sourcePid: z.string(),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .max(documentWaitCeilingMs)
          .optional()
          .describe(`Default ${documentWaitCeilingMs}ms; max ${documentWaitCeilingMs}ms`),
      },
      annotations: readOnlyHint,
    },
    async ({ projectPid, sourcePid, timeoutMs }) => {
      const timeout = timeoutMs ?? documentWaitCeilingMs
      try {
        const outcome = await pollUntilDocumentTerminal(async () => {
          const documents = await api.listDocuments(projectPid)
          const match = documents.find((row) => row.pid === sourcePid)
          if (match === undefined) {
            throw new Error(`Document ${sourcePid} not found`)
          }
          return { status: String(match.status), document: match }
        }, timeout)

        if (!outcome.ready) {
          return toolJsonResult({
            ready: false,
            sourcePid,
            status: outcome.last?.status ?? 'unknown',
            document: outcome.last?.document,
            note: `Extraction is still running after ${timeout}ms. Call air_wait_for_document_extraction again with the same sourcePid to keep waiting.`,
          })
        }

        return toolJsonResult({
          ready: true,
          sourcePid,
          status: outcome.value.status,
          document: outcome.value.document,
        })
      } catch (error) {
        return toolErrorResult(error, 'air_wait_for_document_extraction')
      }
    },
  )

  server.registerTool(
    'air_wait_for_assessment',
    {
      title: MCP_AIR_TOOL_TITLES.air_wait_for_assessment,
      description:
        'Wait until an assessment is completed, failed, or reportAvailable, up to timeoutMs. Uses exponential backoff. Returns ready:false with the last observed status if the wait budget runs out — call again with the same assessmentPid to keep waiting. Requires assessments:read.',
      inputSchema: {
        assessmentPid: z.string(),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .max(assessmentWaitCeilingMs)
          .optional()
          .describe(`Default ${assessmentWaitCeilingMs}ms; max ${assessmentWaitCeilingMs}ms`),
      },
      annotations: readOnlyHint,
    },
    async ({ assessmentPid, timeoutMs }) => {
      const timeout = timeoutMs ?? assessmentWaitCeilingMs
      try {
        const outcome = await pollUntilAssessmentReady(
          () => api.getAssessment(assessmentPid),
          timeout,
        )

        if (!outcome.ready) {
          return toolJsonResult({
            ready: false,
            assessmentPid,
            status: outcome.last?.status ?? 'unknown',
            assessment: outcome.last,
            note: `Assessment is still running after ${timeout}ms. Call air_wait_for_assessment again with the same assessmentPid to keep waiting.`,
          })
        }

        return toolJsonResult({ ready: true, assessmentPid, assessment: outcome.value })
      } catch (error) {
        return toolErrorResult(error, 'air_wait_for_assessment')
      }
    },
  )

  if (surface === 'local') {
    server.experimental.tasks.registerToolTask(
      'air_run_assessment_from_file',
      {
        title: MCP_AIR_TOOL_TITLES.air_run_assessment_from_file,
        description:
          'Upload a local file, wait for extraction, start assessment on the new artifact. Consumes credits. Requires projects:write and assessments:write. Returns an MCP Task handle immediately. Reads filePath with your OS user permissions.',
        inputSchema: {
          projectPid: z.string(),
          filePath: z.string().describe('Absolute or relative path to a local document file'),
          name: z.string().optional().describe('Assessment name (defaults to filename)'),
          contentType: z
            .string()
            .optional()
            .describe('MIME type (inferred from extension when omitted)'),
        },
        annotations: { ...writeHint, destructiveHint: true },
        execution: requiredTaskExecution,
      },
      {
        async createTask(
          { projectPid, filePath, name, contentType },
          { taskStore, taskRequestedTtl },
        ) {
          const { runAssessmentFromFileTask } = await import('../tasks/workers.js')
          const task = await taskStore.createTask({
            ttl: taskRequestedTtl ?? MCP_AIR_ASSESSMENT_TASK_TTL_MS,
            pollInterval: MCP_AIR_DOCUMENT_EXTRACTION_POLL_INTERVAL_MS,
          })
          void runAssessmentFromFileTask(
            api,
            taskStore,
            task.taskId,
            projectPid,
            filePath,
            name,
            contentType,
          )
          return { task }
        },
        ...standardAirTaskHandlers,
      },
    )

    server.experimental.tasks.registerToolTask(
      'air_run_full_assessment_pipeline',
      {
        title: MCP_AIR_TOOL_TITLES.air_run_full_assessment_pipeline,
        description:
          'Start assessment on existing artifacts, wait for completion, return report summary. Consumes credits. Returns an MCP Task handle immediately; poll tasks/get until completed.',
        inputSchema: {
          projectPid: z.string(),
          artifactPids: z.array(z.string()).min(1).max(5),
          name: z.string(),
          waitTimeoutMs: z.number().int().positive().optional(),
        },
        annotations: { ...writeHint, destructiveHint: true },
        execution: requiredTaskExecution,
      },
      {
        async createTask(
          { projectPid, artifactPids, name, waitTimeoutMs },
          { taskStore, taskRequestedTtl },
        ) {
          const task = await taskStore.createTask({
            ttl: taskRequestedTtl ?? MCP_AIR_ASSESSMENT_TASK_TTL_MS,
            pollInterval: MCP_AIR_ASSESSMENT_POLL_INTERVAL_MS,
          })
          void runFullAssessmentPipelineTask(
            api,
            taskStore,
            task.taskId,
            projectPid,
            artifactPids,
            name,
            waitTimeoutMs ?? MCP_AIR_ASSESSMENT_POLL_TIMEOUT_MS,
          )
          return { task }
        },
        ...standardAirTaskHandlers,
      },
    )
  }
}
