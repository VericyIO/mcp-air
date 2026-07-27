import {
  MCP_AIR_ASSESSMENT_POLL_INTERVAL_MS,
  MCP_AIR_ASSESSMENT_POLL_MAX_INTERVAL_MS,
  MCP_AIR_DOCUMENT_EXTRACTION_POLL_INTERVAL_MS,
  MCP_AIR_DOCUMENT_EXTRACTION_POLL_MAX_INTERVAL_MS,
  MCP_AIR_POLL_BACKOFF_MULTIPLIER,
  sleep,
} from './config.js'

const terminalDocumentStatuses = new Set(['connected', 'error'])
const nonRunnableAssessmentStatuses = new Set(['draft'])

export const nextPollIntervalMs = (
  currentMs: number,
  maxMs: number,
  multiplier: number = MCP_AIR_POLL_BACKOFF_MULTIPLIER,
): number => Math.min(Math.round(currentMs * multiplier), maxMs)

export const isDocumentTerminal = (status: string): boolean => terminalDocumentStatuses.has(status)

export const isAssessmentDraft = (status: string): boolean =>
  nonRunnableAssessmentStatuses.has(status)

export const isAssessmentFailed = (status: string): boolean => status === 'failed'

export const isAssessmentCompleted = (status: string): boolean => status === 'completed'

export const isAssessmentReportReady = (assessment: Record<string, unknown>): boolean =>
  isAssessmentCompleted(String(assessment.status)) || assessment.reportAvailable === true

export const pollUntilDocumentTerminal = async (
  fetchStatus: () => Promise<{ status: string; document: Record<string, unknown> } | undefined>,
  deadlineMs: number,
  initialIntervalMs: number = MCP_AIR_DOCUMENT_EXTRACTION_POLL_INTERVAL_MS,
  maxIntervalMs: number = MCP_AIR_DOCUMENT_EXTRACTION_POLL_MAX_INTERVAL_MS,
): Promise<{ status: string; document: Record<string, unknown> }> => {
  const deadline = Date.now() + deadlineMs
  let intervalMs = initialIntervalMs

  while (Date.now() < deadline) {
    const result = await fetchStatus()
    if (result !== undefined && isDocumentTerminal(result.status)) {
      return result
    }
    await sleep(intervalMs)
    intervalMs = nextPollIntervalMs(intervalMs, maxIntervalMs)
  }

  throw new Error('Timed out waiting for document extraction')
}

export const pollUntilAssessmentReady = async (
  fetchAssessment: () => Promise<Record<string, unknown>>,
  deadlineMs: number,
  initialIntervalMs: number = MCP_AIR_ASSESSMENT_POLL_INTERVAL_MS,
  maxIntervalMs: number = MCP_AIR_ASSESSMENT_POLL_MAX_INTERVAL_MS,
): Promise<Record<string, unknown>> => {
  const deadline = Date.now() + deadlineMs
  let intervalMs = initialIntervalMs

  while (Date.now() < deadline) {
    const assessment = await fetchAssessment()
    const status = String(assessment.status)
    if (isAssessmentDraft(status)) {
      const assessmentPid = typeof assessment.pid === 'string' ? assessment.pid : 'unknown'
      throw new Error(
        `Assessment ${assessmentPid} is still a draft — start it with air_start_assessment before waiting`,
      )
    }
    if (isAssessmentFailed(status) || isAssessmentReportReady(assessment)) {
      return assessment
    }
    await sleep(intervalMs)
    intervalMs = nextPollIntervalMs(intervalMs, maxIntervalMs)
  }

  throw new Error('Timed out waiting for assessment')
}
