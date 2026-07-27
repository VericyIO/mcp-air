import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { IntegratorApiClient } from '../client/integrator-api.js'
import {
  MCP_AIR_ASSESSMENT_REPORT_URI_TEMPLATE,
  MCP_AIR_ASSESSMENT_STAGES_URI_TEMPLATE,
  MCP_AIR_PROJECT_ASSESSMENTS_URI_TEMPLATE,
} from '../constants.js'
import { runResourceHandler } from '../errors.js'

const noResourceListing = undefined

export const registerReportResources = (server: McpServer, api: IntegratorApiClient) => {
  server.resource(
    'assessment-report',
    new ResourceTemplate(MCP_AIR_ASSESSMENT_REPORT_URI_TEMPLATE, { list: noResourceListing }),
    {
      description: 'Full AssessmentReport JSON for a completed assessment',
      mimeType: 'application/json',
    },
    async (uri) =>
      runResourceHandler('resource:assessment-report', async () => {
        const assessmentPid = parseAssessmentPidFromReportUri(String(uri))
        const report = await api.getAssessmentReport(assessmentPid)
        return {
          contents: [
            {
              uri: String(uri),
              mimeType: 'application/json',
              text: JSON.stringify(report, null, 2),
            },
          ],
        }
      }),
  )

  server.resource(
    'assessment-stages',
    new ResourceTemplate(MCP_AIR_ASSESSMENT_STAGES_URI_TEMPLATE, { list: noResourceListing }),
    {
      description: 'Assessment stage checkpoint logs',
      mimeType: 'application/json',
    },
    async (uri) =>
      runResourceHandler('resource:assessment-stages', async () => {
        const assessmentPid = parseAssessmentPidFromStagesUri(String(uri))
        const stages = await api.listAssessmentStages(assessmentPid)
        return {
          contents: [
            {
              uri: String(uri),
              mimeType: 'application/json',
              text: JSON.stringify(stages, null, 2),
            },
          ],
        }
      }),
  )

  server.resource(
    'project-assessments',
    new ResourceTemplate(MCP_AIR_PROJECT_ASSESSMENTS_URI_TEMPLATE, { list: noResourceListing }),
    {
      description: 'Assessment list summary for a project',
      mimeType: 'application/json',
    },
    async (uri) =>
      runResourceHandler('resource:project-assessments', async () => {
        const projectPid = parseProjectPidFromListUri(String(uri))
        const assessments = await api.listAssessments(projectPid)
        return {
          contents: [
            {
              uri: String(uri),
              mimeType: 'application/json',
              text: JSON.stringify(assessments, null, 2),
            },
          ],
        }
      }),
  )
}

const parseAssessmentPidFromReportUri = (uri: string): string => {
  const match = /^air:\/\/assessments\/([^/]+)\/report$/.exec(uri)
  const assessmentPid = match?.[1]
  if (assessmentPid === undefined) {
    throw new Error(`Invalid assessment report URI: ${uri}`)
  }
  return assessmentPid
}

const parseAssessmentPidFromStagesUri = (uri: string): string => {
  const match = /^air:\/\/assessments\/([^/]+)\/stages$/.exec(uri)
  const assessmentPid = match?.[1]
  if (assessmentPid === undefined) {
    throw new Error(`Invalid assessment stages URI: ${uri}`)
  }
  return assessmentPid
}

const parseProjectPidFromListUri = (uri: string): string => {
  const match = /^air:\/\/projects\/([^/]+)\/assessments$/.exec(uri)
  const projectPid = match?.[1]
  if (projectPid === undefined) {
    throw new Error(`Invalid project assessments URI: ${uri}`)
  }
  return projectPid
}
