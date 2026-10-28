import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { IntegratorApiClient } from '../client/integrator-api.js'
import {
  MCP_AIR_ASK_SCREENING_QUESTIONS_DESCRIPTION,
  MCP_AIR_SCREENING_DECLINED_NOTE,
  MCP_AIR_SCREENING_DONE_NOTE,
  MCP_AIR_SCREENING_HOLD_NEXT_STEP,
  MCP_AIR_SCREENING_NO_FORM_NEXT_STEP,
} from '../config.js'
import { supportsElicitation } from '../elicitation.js'
import { toolErrorResult, toolJsonResult } from '../errors.js'
import {
  answerLabel,
  askQuestion,
  readQuestion,
  readScreeningGroups,
  type FactAnswer,
  type Question,
} from '../forms/fact-form.js'
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

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
    'air_ask_screening_questions',
    {
      title: MCP_AIR_TOOL_TITLES.air_ask_screening_questions,
      description: MCP_AIR_ASK_SCREENING_QUESTIONS_DESCRIPTION,
      inputSchema: { projectPid: z.string() },
      annotations: { ...readOnly, title: MCP_AIR_TOOL_TITLES.air_ask_screening_questions },
    },
    async ({ projectPid }) => {
      try {
        const raw = await api.listScreeningQuestions(projectPid)
        if (!isRecord(raw) || !Array.isArray(raw.questions)) {
          throw new Error('Screening questions response is missing questions')
        }
        const groups = readScreeningGroups(raw.screeningGroups)
        const questions = raw.questions.map(readQuestion)
        if (groups.length === 0) {
          return toolJsonResult({ projectPid, answers: [], note: MCP_AIR_SCREENING_DONE_NOTE })
        }
        if (!supportsElicitation(server)) {
          return toolJsonResult({
            projectPid,
            checklist: groups,
            questions,
            nextStep: MCP_AIR_SCREENING_NO_FORM_NEXT_STEP,
          })
        }

        const questionsByPath = new Map(questions.map((question) => [question.factPath, question]))
        const ordered: Question[] = []
        const seen = new Set<string>()
        for (const group of groups) {
          for (const factPath of group.factPaths) {
            const question = questionsByPath.get(factPath)
            if (question === undefined || seen.has(factPath)) continue
            ordered.push(question)
            seen.add(factPath)
          }
        }
        for (const question of questions) {
          if (seen.has(question.factPath)) continue
          ordered.push(question)
          seen.add(question.factPath)
        }

        const answers: FactAnswer[] = []
        for (const question of ordered) {
          const asked = await askQuestion(server, question)
          if (asked.closed) {
            return toolJsonResult({
              projectPid,
              declined: true,
              note: MCP_AIR_SCREENING_DECLINED_NOTE,
            })
          }
          answers.push({ factPath: question.factPath, value: asked.value })
        }

        const question = (factPath: string) => {
          const found = questionsByPath.get(factPath)
          if (found === undefined) throw new Error(`Screening fact ${factPath} has no question`)
          return found
        }
        return toolJsonResult({
          projectPid,
          answers: answers
            .filter((answer) => answer.value !== null)
            .map((answer) => ({
              factPath: answer.factPath,
              value: answer.value,
              question: question(answer.factPath).question,
              answer: answerLabel(question(answer.factPath), answer.value),
            })),
          notSure: answers
            .filter((answer) => answer.value === null)
            .map((answer) => question(answer.factPath).question),
          nextStep: MCP_AIR_SCREENING_HOLD_NEXT_STEP,
        })
      } catch (error) {
        return toolErrorResult(error, 'air_ask_screening_questions')
      }
    },
  )

  server.registerTool(
    'air_save_prepared_answers',
    {
      title: MCP_AIR_TOOL_TITLES.air_save_prepared_answers,
      description:
        'Save the checklist answers right after air_start_assessment. They are kept on the project and applied when the scan reads its facts; a scan that reads a different value from the documents raises it as a conflict. Refused once the scan has read its facts. It does not recompute the tier. Requires assessments:write.',
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
        'due is true when the latest completed scan used older AIR EU AI Act rules and nobody has said later to the current ones. lastCompleted.tier is the stored tier and lastCompleted.tierUnderCurrentRules is what the same facts give now. postponed says when someone said later to the current rules. Do not decide the version yourself. Requires projects:read.',
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
    'air_postpone_rules_notice',
    {
      title: MCP_AIR_TOOL_TITLES.air_postpone_rules_notice,
      description:
        'The person said later to the current AIR rules. Records who and when. The notice returns when the rules move past this version. Refused when nothing is due. Requires projects:write.',
      inputSchema: { projectPid: z.string() },
      annotations: { ...writeHint, title: MCP_AIR_TOOL_TITLES.air_postpone_rules_notice },
    },
    async ({ projectPid }) => {
      try {
        return toolJsonResult(await api.postponeRulesNotice(projectPid))
      } catch (error) {
        return toolErrorResult(error, 'air_postpone_rules_notice')
      }
    },
  )

  server.registerTool(
    'air_recheck_tier',
    {
      title: MCP_AIR_TOOL_TITLES.air_recheck_tier,
      description:
        "Re-check a scan's EU AI Act tier under the current AIR rules from the facts it already holds. Reads no documents and spends no credit. Returns previousTier, the new tier, and the questions that can still change it. Requires assessments:write.",
      inputSchema: { assessmentPid: z.string() },
      annotations: { ...writeHint, title: MCP_AIR_TOOL_TITLES.air_recheck_tier },
    },
    async ({ assessmentPid }) => {
      try {
        return toolJsonResult(await api.recheckTier(assessmentPid))
      } catch (error) {
        return toolErrorResult(error, 'air_recheck_tier')
      }
    },
  )
}
