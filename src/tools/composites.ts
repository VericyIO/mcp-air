import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { IntegratorApiClient } from '../client/integrator-api.js'
import {
  MCP_AIR_ASSESSMENT_POLL_INTERVAL_MS,
  MCP_AIR_ASSESSMENT_POLL_TIMEOUT_MS,
  MCP_AIR_ASSESSMENT_TASK_TTL_MS,
  MCP_AIR_DOCUMENT_EXTRACTION_POLL_INTERVAL_MS,
  MCP_AIR_DOCUMENT_EXTRACTION_POLL_TIMEOUT_MS,
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

/** MCP Tasks execution — long-running pipeline tools return a task handle immediately. */
const requiredTaskExecution = {
  taskSupport: 'required' as const,
}

/**
 * Wait tools are plain blocking tools so clients without MCP Tasks support can
 * finish an assessment workflow. Cap timeoutMs at the configured defaults.
 * Task-capable clients can still use air_run_* pipeline tools for non-blocking waits.
 */
export const registerCompositeTools = (
  server: McpServer,
  api: IntegratorApiClient,
  surface: McpAirSurface = 'local',
) => {
  server.registerTool(
    'air_wait_for_document_extraction',
    {
      title: MCP_AIR_TOOL_TITLES.air_wait_for_document_extraction,
      description:
        'Block until sourcePid reaches connected or error, or timeoutMs elapses. Uses exponential backoff. Prefer a modest timeoutMs (e.g. 120000) when the client request budget is short. Requires projects:read.',
      inputSchema: {
        projectPid: z.string(),
        sourcePid: z.string(),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .max(MCP_AIR_DOCUMENT_EXTRACTION_POLL_TIMEOUT_MS)
          .optional()
          .describe(
            `Default ${MCP_AIR_DOCUMENT_EXTRACTION_POLL_TIMEOUT_MS}ms; max ${MCP_AIR_DOCUMENT_EXTRACTION_POLL_TIMEOUT_MS}ms`,
          ),
      },
      annotations: readOnlyHint,
    },
    async ({ projectPid, sourcePid, timeoutMs }) => {
      const timeout = timeoutMs ?? MCP_AIR_DOCUMENT_EXTRACTION_POLL_TIMEOUT_MS
      try {
        const result = await pollUntilDocumentTerminal(async () => {
          const documents = await api.listDocuments(projectPid)
          const match = documents.find((row) => row.pid === sourcePid)
          if (match === undefined) {
            throw new Error(`Document ${sourcePid} not found`)
          }
          return { status: String(match.status), document: match }
        }, timeout)
        return toolJsonResult({ sourcePid, status: result.status, document: result.document })
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
        'Block until assessment is completed, failed, or reportAvailable, or timeoutMs elapses. Uses exponential backoff. Prefer a modest timeoutMs when the client request budget is short. Requires assessments:read.',
      inputSchema: {
        assessmentPid: z.string(),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .max(MCP_AIR_ASSESSMENT_POLL_TIMEOUT_MS)
          .optional()
          .describe(
            `Default ${MCP_AIR_ASSESSMENT_POLL_TIMEOUT_MS}ms; max ${MCP_AIR_ASSESSMENT_POLL_TIMEOUT_MS}ms`,
          ),
      },
      annotations: readOnlyHint,
    },
    async ({ assessmentPid, timeoutMs }) => {
      const timeout = timeoutMs ?? MCP_AIR_ASSESSMENT_POLL_TIMEOUT_MS
      try {
        const assessment = await pollUntilAssessmentReady(
          () => api.getAssessment(assessmentPid),
          timeout,
        )
        return toolJsonResult(assessment)
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
  }

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
