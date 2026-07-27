import path from 'node:path'

import type { IntegratorApiClient } from '../client/integrator-api.js'
import {
  MCP_AIR_ASSESSMENT_POLL_INTERVAL_MS,
  MCP_AIR_ASSESSMENT_POLL_MAX_INTERVAL_MS,
  MCP_AIR_DOCUMENT_EXTRACTION_POLL_INTERVAL_MS,
  MCP_AIR_DOCUMENT_EXTRACTION_POLL_MAX_INTERVAL_MS,
  MCP_AIR_DOCUMENT_EXTRACTION_POLL_TIMEOUT_MS,
  sleep,
} from '../config.js'
import { toolErrorResult, toolJsonResult } from '../errors.js'
import {
  isAssessmentFailed,
  isAssessmentReportReady,
  isDocumentTerminal,
  nextPollIntervalMs,
} from '../poll.js'
import {
  completeAirTask,
  failAirTask,
  isTaskCancelled,
  updateTaskProgress,
  type AirTaskStore,
} from './task-handlers.js'

export const runWaitForDocumentExtractionTask = async (
  api: IntegratorApiClient,
  taskStore: AirTaskStore,
  taskId: string,
  projectPid: string,
  sourcePid: string,
  timeoutMs: number,
): Promise<void> => {
  const toolName = 'air_wait_for_document_extraction'
  try {
    const deadline = Date.now() + timeoutMs
    let intervalMs: number = MCP_AIR_DOCUMENT_EXTRACTION_POLL_INTERVAL_MS

    while (Date.now() < deadline) {
      if (await isTaskCancelled(taskStore, taskId)) {
        return
      }

      const documents = await api.listDocuments(projectPid)
      const match = documents.find((row) => row.pid === sourcePid)
      if (match === undefined) {
        await failAirTask(
          taskStore,
          taskId,
          toolErrorResult(new Error(`Document ${sourcePid} not found`), toolName),
        )
        return
      }

      const status = String(match.status)
      if (!(await updateTaskProgress(taskStore, taskId, `Document status: ${status}`))) {
        return
      }

      if (isDocumentTerminal(status)) {
        await completeAirTask(
          taskStore,
          taskId,
          toolJsonResult({ sourcePid, status, document: match }),
        )
        return
      }

      await sleep(intervalMs)
      intervalMs = nextPollIntervalMs(intervalMs, MCP_AIR_DOCUMENT_EXTRACTION_POLL_MAX_INTERVAL_MS)
    }

    await failAirTask(
      taskStore,
      taskId,
      toolErrorResult(
        new Error(`Timed out waiting for document ${sourcePid} extraction`),
        toolName,
      ),
    )
  } catch (error) {
    await failAirTask(taskStore, taskId, toolErrorResult(error, toolName))
  }
}

export const runWaitForAssessmentTask = async (
  api: IntegratorApiClient,
  taskStore: AirTaskStore,
  taskId: string,
  assessmentPid: string,
  timeoutMs: number,
): Promise<void> => {
  const toolName = 'air_wait_for_assessment'
  try {
    const deadline = Date.now() + timeoutMs
    let intervalMs: number = MCP_AIR_ASSESSMENT_POLL_INTERVAL_MS

    while (Date.now() < deadline) {
      if (await isTaskCancelled(taskStore, taskId)) {
        return
      }

      const assessment = await api.getAssessment(assessmentPid)
      const status = String(assessment.status)

      if (status === 'draft') {
        await failAirTask(
          taskStore,
          taskId,
          toolErrorResult(
            new Error(
              `Assessment ${assessmentPid} is still a draft — start it with air_start_assessment before waiting`,
            ),
            toolName,
          ),
        )
        return
      }

      if (!(await updateTaskProgress(taskStore, taskId, `Assessment status: ${status}`))) {
        return
      }

      if (isAssessmentFailed(status) || isAssessmentReportReady(assessment)) {
        await completeAirTask(
          taskStore,
          taskId,
          toolJsonResult({ assessmentPid, status, assessment }),
        )
        return
      }

      await sleep(intervalMs)
      intervalMs = nextPollIntervalMs(intervalMs, MCP_AIR_ASSESSMENT_POLL_MAX_INTERVAL_MS)
    }

    await failAirTask(
      taskStore,
      taskId,
      toolErrorResult(new Error(`Timed out waiting for assessment ${assessmentPid}`), toolName),
    )
  } catch (error) {
    await failAirTask(taskStore, taskId, toolErrorResult(error, toolName))
  }
}

export const runFullAssessmentPipelineTask = async (
  api: IntegratorApiClient,
  taskStore: AirTaskStore,
  taskId: string,
  projectPid: string,
  artifactPids: ReadonlyArray<string>,
  name: string,
  waitTimeoutMs: number,
): Promise<void> => {
  const toolName = 'air_run_full_assessment_pipeline'
  try {
    if (!(await updateTaskProgress(taskStore, taskId, 'Starting assessment...'))) {
      return
    }

    const started = await api.startAssessment(projectPid, name, [...artifactPids])
    const assessmentPid = started.assessmentPid
    const deadline = Date.now() + waitTimeoutMs
    let intervalMs: number = MCP_AIR_ASSESSMENT_POLL_INTERVAL_MS

    while (Date.now() < deadline) {
      if (await isTaskCancelled(taskStore, taskId)) {
        return
      }

      const assessment = await api.getAssessment(assessmentPid)
      const status = String(assessment.status)

      if (!(await updateTaskProgress(taskStore, taskId, `Assessment status: ${status}`))) {
        return
      }

      if (isAssessmentFailed(status)) {
        await completeAirTask(
          taskStore,
          taskId,
          toolJsonResult({ status, assessment, assessmentPid }),
        )
        return
      }

      if (isAssessmentReportReady(assessment)) {
        const report = await api.getAssessmentReport(assessmentPid)
        await completeAirTask(
          taskStore,
          taskId,
          toolJsonResult({
            status,
            assessmentPid,
            overview: report.overview,
            projectName: report.projectName,
            euAiActTier: report.euAiActTier,
          }),
        )
        return
      }

      await sleep(intervalMs)
      intervalMs = nextPollIntervalMs(intervalMs, MCP_AIR_ASSESSMENT_POLL_MAX_INTERVAL_MS)
    }

    await failAirTask(
      taskStore,
      taskId,
      toolErrorResult(new Error('Timed out waiting for assessment to complete'), toolName),
    )
  } catch (error) {
    await failAirTask(taskStore, taskId, toolErrorResult(error, toolName))
  }
}

export const runAssessmentFromFileTask = async (
  api: IntegratorApiClient,
  taskStore: AirTaskStore,
  taskId: string,
  projectPid: string,
  filePath: string,
  name: string | undefined,
  contentType: string | undefined,
): Promise<void> => {
  const toolName = 'air_run_assessment_from_file'
  try {
    const resolved = path.resolve(filePath)
    const filename = path.basename(resolved)
    const resolvedContentType = contentType ?? inferContentType(filename)

    if (!(await updateTaskProgress(taskStore, taskId, `Uploading ${filename}...`))) {
      return
    }

    const init = await api.initUpload(projectPid, filename, resolvedContentType)
    await api.uploadFileToPresignedUrl(init.uploadUrl, resolved, resolvedContentType)
    const complete = await api.completeUpload(projectPid, {
      s3Key: init.s3Key,
      filename,
      contentType: resolvedContentType,
    })

    const deadline = Date.now() + MCP_AIR_DOCUMENT_EXTRACTION_POLL_TIMEOUT_MS
    let intervalMs: number = MCP_AIR_DOCUMENT_EXTRACTION_POLL_INTERVAL_MS
    let extractionDone = false

    while (Date.now() < deadline) {
      if (await isTaskCancelled(taskStore, taskId)) {
        return
      }

      const documents = await api.listDocuments(projectPid)
      const match = documents.find((row) => row.pid === complete.sourcePid)
      if (match !== undefined) {
        const status = String(match.status)
        if (!(await updateTaskProgress(taskStore, taskId, `Extraction status: ${status}`))) {
          return
        }
        if (isDocumentTerminal(status)) {
          if (status === 'error') {
            await failAirTask(
              taskStore,
              taskId,
              toolErrorResult(
                new Error(`Document extraction failed for ${complete.sourcePid}`),
                toolName,
              ),
            )
            return
          }
          extractionDone = true
          break
        }
      }

      await sleep(intervalMs)
      intervalMs = nextPollIntervalMs(intervalMs, MCP_AIR_DOCUMENT_EXTRACTION_POLL_MAX_INTERVAL_MS)
    }

    if (!extractionDone) {
      await failAirTask(
        taskStore,
        taskId,
        toolErrorResult(
          new Error(`Timed out waiting for document ${complete.sourcePid} extraction`),
          toolName,
        ),
      )
      return
    }

    if (
      !(await updateTaskProgress(
        taskStore,
        taskId,
        'Starting assessment on extracted artifacts...',
      ))
    ) {
      return
    }

    const artifacts = await api.listArtifacts(projectPid)
    const artifactPids = artifacts
      .filter((row) => row.sourcePid === complete.sourcePid)
      .map((row) => String(row.pid))

    if (artifactPids.length === 0) {
      await failAirTask(
        taskStore,
        taskId,
        toolErrorResult(new Error('No artifacts produced after extraction'), toolName),
      )
      return
    }

    const assessmentName = name ?? `MCP assessment - ${filename}`
    const started = await api.startAssessment(projectPid, assessmentName, artifactPids.slice(0, 5))

    await completeAirTask(
      taskStore,
      taskId,
      toolJsonResult({
        sourcePid: complete.sourcePid,
        workflowPid: complete.workflowPid,
        artifactPids: artifactPids.slice(0, 5),
        assessmentPid: started.assessmentPid,
        workflowRunId: started.workflowRunId,
      }),
    )
  } catch (error) {
    await failAirTask(taskStore, taskId, toolErrorResult(error, toolName))
  }
}

const inferContentType = (filename: string): string => {
  const ext = path.extname(filename).toLowerCase()
  switch (ext) {
    case '.pdf':
      return 'application/pdf'
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case '.pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    case '.csv':
      return 'text/csv'
    case '.json':
      return 'application/json'
    case '.txt':
      return 'text/plain'
    case '.md':
      return 'text/markdown'
    default:
      return 'application/octet-stream'
  }
}
