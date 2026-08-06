import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { IntegratorApiClient } from '../client/integrator-api.js'
import { MCP_AIR_MAX_TOOL_RESULT_CHARS } from '../config.js'
import { toolErrorResult, toolJsonResult, toolJsonResultWithinBudget } from '../errors.js'
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

const REPORT_SECTIONS = [
  'overview',
  'quality',
  'systemProfile',
  'riskRegister',
  'watchlist',
  'clearedThemes',
  'cannotEvaluateThemes',
  'controlMatrix',
  'overlays',
  'controlEvidence',
  'positions',
  'lensViews',
  'euAiActTier',
  'euAiActFacts',
  'evidenceAppendix',
  'inputArtifacts',
] as const

type ReportSection = (typeof REPORT_SECTIONS)[number]

const pickReportSection = (
  report: Record<string, unknown>,
  section: ReportSection,
): Record<string, unknown> => {
  const value = report[section]
  return {
    assessmentPid: report.assessmentPid,
    projectName: report.projectName,
    section,
    [section]: value ?? null,
  }
}

/** Room left for the JSON envelope around a paged section. */
const SECTION_PAGE_ENVELOPE_CHARS = 2_000

/**
 * Table of contents for a report: what each section holds and how big it serializes to.
 * Lets a caller that hit the size ceiling pick sections deliberately instead of guessing.
 */
const describeReportSections = (report: Record<string, unknown>) =>
  REPORT_SECTIONS.map((section) => {
    const value = report[section]
    return {
      section,
      present: value !== undefined && value !== null,
      ...(Array.isArray(value) ? { itemCount: value.length } : {}),
      chars: value === undefined ? 0 : JSON.stringify(value).length,
    }
  })

/** Take as many leading items as fit the budget, always at least one. */
const fitItems = (items: ReadonlyArray<unknown>, budgetChars: number) => {
  const kept: unknown[] = []
  let used = 0
  for (const item of items) {
    const cost = JSON.stringify(item).length + 2
    if (used + cost > budgetChars && kept.length > 0) {
      break
    }
    kept.push(item)
    used += cost
  }
  return kept
}

const buildAssessmentSummary = (report: Record<string, unknown>) => ({
  assessmentPid: report.assessmentPid,
  projectName: report.projectName,
  projectOverview: report.projectOverview,
  overview: report.overview,
  quality: report.quality,
  euAiActTier: report.euAiActTier,
  systemProfile: report.systemProfile,
  riskRegisterCount: Array.isArray(report.riskRegister) ? report.riskRegister.length : 0,
  watchlistCount: Array.isArray(report.watchlist) ? report.watchlist.length : 0,
  clearedThemesCount: Array.isArray(report.clearedThemes) ? report.clearedThemes.length : 0,
  cannotEvaluateThemesCount: Array.isArray(report.cannotEvaluateThemes)
    ? report.cannotEvaluateThemes.length
    : 0,
  evidenceAppendixCount: Array.isArray(report.evidenceAppendix)
    ? report.evidenceAppendix.length
    : 0,
  inputArtifactCount: Array.isArray(report.inputArtifacts) ? report.inputArtifacts.length : 0,
})

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
      inputSchema: {
        assessmentPid: z.string().describe('Assessment pid (pasm_*)'),
      },
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
        'Fetch the structured risk assessment report for a completed run. Omit section to get the whole report; if it is too large for one response you get a section index instead — each section with its size and item count — so you can pull the parts you need. Pass section for one slice, and offset/limit to page through a list section such as riskRegister or evidenceAppendix. Requires assessments:read.',
      inputSchema: {
        assessmentPid: z.string(),
        section: z
          .enum(REPORT_SECTIONS)
          .optional()
          .describe('Report section to return instead of the whole report'),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('First item to return when section is a list (default 0)'),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Max items to return when section is a list'),
      },
      annotations: readOnly,
    },
    async ({ assessmentPid, section, offset, limit }) => {
      try {
        const report = await api.getAssessmentReport(assessmentPid)

        if (section === undefined) {
          const whole = JSON.stringify(report, null, 2)
          if (whole.length <= MCP_AIR_MAX_TOOL_RESULT_CHARS) {
            return { content: [{ type: 'text' as const, text: whole }] }
          }
          return toolJsonResultWithinBudget(
            {
              assessmentPid,
              projectName: report.projectName,
              complete: false,
              reason: `The whole report is ${whole.length} characters, over the ${MCP_AIR_MAX_TOOL_RESULT_CHARS} character limit for one tool result.`,
              nextStep:
                'Call air_get_assessment_report again with section set to the part you need. List sections also accept offset and limit.',
              summary: buildAssessmentSummary(report),
              sections: describeReportSections(report),
            },
            MCP_AIR_MAX_TOOL_RESULT_CHARS,
            () =>
              `Report ${assessmentPid} is too large to index in one response. Call air_get_assessment_summary for triage, then air_get_assessment_report with one of these sections: ${REPORT_SECTIONS.join(', ')}.`,
          )
        }

        const value = report[section]

        if (Array.isArray(value)) {
          const start = offset ?? 0
          const requested = limit === undefined ? value.slice(start) : value.slice(start, start + limit)
          const items = fitItems(
            requested,
            MCP_AIR_MAX_TOOL_RESULT_CHARS - SECTION_PAGE_ENVELOPE_CHARS,
          )
          const nextOffset = start + items.length
          return toolJsonResult({
            assessmentPid,
            projectName: report.projectName,
            section,
            totalItems: value.length,
            offset: start,
            returned: items.length,
            complete: nextOffset >= value.length,
            ...(nextOffset < value.length ? { nextOffset } : {}),
            [section]: items,
          })
        }

        return toolJsonResultWithinBudget(
          pickReportSection(report, section),
          MCP_AIR_MAX_TOOL_RESULT_CHARS,
          (actualChars) =>
            `Section "${section}" of report ${assessmentPid} is ${actualChars} characters, over the ${MCP_AIR_MAX_TOOL_RESULT_CHARS} character limit for one tool result. It is not a list, so it cannot be paged — read the whole report from the air://assessments/${assessmentPid}/report resource instead.`,
        )
      } catch (error) {
        return toolErrorResult(error, 'air_get_assessment_report')
      }
    },
  )

  server.registerTool(
    'air_get_assessment_summary',
    {
      title: MCP_AIR_TOOL_TITLES.air_get_assessment_summary,
      description:
        'Fetch a slim assessment report summary (overview, quality, EU AI Act tier, and section counts) without the full risk/evidence payload. Prefer this over air_get_assessment_report for triage. Requires assessments:read.',
      inputSchema: { assessmentPid: z.string() },
      annotations: readOnly,
    },
    async ({ assessmentPid }) => {
      try {
        const report = await api.getAssessmentReport(assessmentPid)
        return toolJsonResult(buildAssessmentSummary(report))
      } catch (error) {
        return toolErrorResult(error, 'air_get_assessment_summary')
      }
    },
  )

  server.registerTool(
    'air_list_open_facts',
    {
      title: MCP_AIR_TOOL_TITLES.air_list_open_facts,
      description:
        'List the deduplicated open EU AI Act fact worklist for an assessment (each missing fact once, with criteria it unblocks). Requires assessments:read.',
      inputSchema: { assessmentPid: z.string() },
      annotations: readOnly,
    },
    async ({ assessmentPid }) => {
      try {
        return toolJsonResult(await api.listOpenFacts(assessmentPid))
      } catch (error) {
        return toolErrorResult(error, 'air_list_open_facts')
      }
    },
  )

  server.registerTool(
    'air_submit_fact_answers',
    {
      title: MCP_AIR_TOOL_TITLES.air_submit_fact_answers,
      description:
        'Submit answers for open EU AI Act facts and re-derive the waterfall tier. Pass factPath + value (+ optional justification). Requires assessments:write.',
      inputSchema: {
        assessmentPid: z.string(),
        answers: z
          .array(
            z.object({
              factPath: z.string(),
              value: z.union([z.boolean(), z.array(z.string()), z.null()]),
              justification: z.string().optional(),
              evidenceChunkIds: z.array(z.string()).optional(),
            }),
          )
          .min(1),
      },
      annotations: writeHint,
    },
    async ({ assessmentPid, answers }) => {
      try {
        return toolJsonResult(await api.submitFactAnswers(assessmentPid, answers))
      } catch (error) {
        return toolErrorResult(error, 'air_submit_fact_answers')
      }
    },
  )

  server.registerTool(
    'air_get_assessment_stages',
    {
      title: MCP_AIR_TOOL_TITLES.air_get_assessment_stages,
      description:
        'List per-stage checkpoint logs for an assessment run. Requires assessments:read.',
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
      description:
        'Create an assessment draft without starting the pipeline. Requires assessments:write.',
      inputSchema: {
        projectPid: z.string(),
        name: z.string().describe('Display name for the assessment'),
        artifactPids: z
          .array(z.string())
          .min(1)
          .max(5)
          .describe('Up to five artifact pids'),
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
