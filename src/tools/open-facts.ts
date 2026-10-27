import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ElicitRequestFormParams } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import type { IntegratorApiClient } from '../client/integrator-api.js'
import {
  factConflictLine,
  factSuggestionLine,
  MCP_AIR_ASK_OPEN_FACTS_DESCRIPTION,
  MCP_AIR_FACT_ANSWER_NO,
  MCP_AIR_FACT_ANSWER_NO_LABEL,
  MCP_AIR_FACT_ANSWER_NOT_SURE,
  MCP_AIR_FACT_ANSWER_NOT_SURE_LABEL,
  MCP_AIR_FACT_ANSWER_YES,
  MCP_AIR_FACT_ANSWER_YES_LABEL,
  MCP_AIR_FACT_BOOLEAN_CHOICE_LABELS,
  MCP_AIR_FACT_BOOLEAN_CHOICES,
  MCP_AIR_FACT_FORM_DECLINED_NOTE,
  MCP_AIR_FACT_FORM_JUSTIFICATION,
  MCP_AIR_FACT_FORM_MAX_QUESTIONS,
  MCP_AIR_FACT_FORM_MESSAGE,
  MCP_AIR_MORE_QUESTIONS_NEXT_STEP,
  MCP_AIR_NO_FORM_NEXT_STEP,
  MCP_AIR_NO_OPEN_QUESTIONS_NOTE,
} from '../config.js'
import { supportsElicitation } from '../elicitation.js'
import { toolErrorResult, toolJsonResult } from '../errors.js'
import { MCP_AIR_TOOL_TITLES } from '../tool-titles.js'

const writeHint = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
} as const

type FactOption = {
  readonly value: string
  readonly label: string
}

type BooleanFact = {
  readonly factPath: string
  readonly question: string
  readonly help: string
  readonly valueKind: 'boolean'
}

type ArrayFact = {
  readonly factPath: string
  readonly question: string
  readonly help: string
  readonly valueKind: 'array'
  readonly options: readonly FactOption[]
}

type OpenFact = BooleanFact | ArrayFact

type FactValue = boolean | readonly string[] | null

type AnswerConflict = OpenFact & {
  readonly keptValue: FactValue
  readonly scanValue: FactValue
  readonly excerpts: readonly string[]
}

type ProposedAnswer = {
  readonly factPath: string
  readonly value: FactValue
  readonly reason: string
}

type OpenFactsPayload = {
  readonly openFacts: readonly OpenFact[]
  readonly answerConflicts: readonly AnswerConflict[]
  readonly tier: unknown
}

type AskItem = {
  readonly fact: OpenFact
  readonly conflict: AnswerConflict | undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readString = (row: Record<string, unknown>, key: string): string => {
  const value = row[key]
  if (typeof value !== 'string') {
    const factPath = typeof row.factPath === 'string' ? row.factPath : '(unknown fact)'
    throw new Error(`Open fact ${factPath} is missing ${key}`)
  }
  return value
}

const readOptions = (row: Record<string, unknown>, factPath: string): readonly FactOption[] => {
  const options = row.options
  if (!Array.isArray(options)) {
    throw new Error(`Open fact ${factPath} is missing options`)
  }
  return options.map((option, index) => {
    if (!isRecord(option) || typeof option.value !== 'string' || typeof option.label !== 'string') {
      throw new Error(`Open fact ${factPath} option ${index} is missing value or label`)
    }
    return { value: option.value, label: option.label }
  })
}

const readFact = (row: Record<string, unknown>): OpenFact => {
  const factPath = readString(row, 'factPath')
  const question = readString(row, 'question')
  const help = readString(row, 'help')
  if (row.valueKind === 'boolean') {
    return { factPath, question, help, valueKind: 'boolean' }
  }
  if (row.valueKind === 'array') {
    return { factPath, question, help, valueKind: 'array', options: readOptions(row, factPath) }
  }
  throw new Error(`Open fact ${factPath} has unknown valueKind`)
}

const readFactValue = (value: unknown, fact: OpenFact, field: string): FactValue => {
  if (value === null) {
    return null
  }
  if (fact.valueKind === 'boolean') {
    if (typeof value === 'boolean') {
      return value
    }
    throw new Error(`Open fact ${fact.factPath} ${field} is not a boolean`)
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value
  }
  throw new Error(`Open fact ${fact.factPath} ${field} is not a list`)
}

const readConflict = (row: Record<string, unknown>): AnswerConflict => {
  const fact = readFact(row)
  const excerpts = row.excerpts
  if (!Array.isArray(excerpts) || excerpts.some((item) => typeof item !== 'string')) {
    throw new Error(`Open fact ${fact.factPath} excerpts are not text`)
  }
  return {
    ...fact,
    keptValue: readFactValue(row.keptValue, fact, 'keptValue'),
    scanValue: readFactValue(row.scanValue, fact, 'scanValue'),
    excerpts,
  }
}

const readFactList = (value: unknown, key: string): readonly Record<string, unknown>[] => {
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) {
    throw new Error(`Open facts response is missing ${key}`)
  }
  return value
}

const parseOpenFactsPayload = (raw: unknown): OpenFactsPayload => {
  if (!isRecord(raw)) {
    throw new Error('Open facts response is not an object')
  }
  if (!isRecord(raw.euAiActTier) || !('tier' in raw.euAiActTier)) {
    throw new Error('Open facts response is missing euAiActTier.tier')
  }
  const tier = raw.euAiActTier.tier
  if (tier !== null && !isRecord(tier)) {
    throw new Error('Open facts response tier is not an object')
  }
  return {
    openFacts: readFactList(raw.openFacts, 'openFacts').map(readFact),
    answerConflicts: readFactList(raw.answerConflicts, 'answerConflicts').map(readConflict),
    tier,
  }
}

const orderedItems = (payload: OpenFactsPayload): readonly AskItem[] => [
  ...payload.answerConflicts.map((conflict) => ({ fact: conflict, conflict })),
  ...payload.openFacts.map((fact) => ({ fact, conflict: undefined })),
]

const indexProposals = (
  proposed: ReadonlyArray<ProposedAnswer> | undefined,
): ReadonlyMap<string, ProposedAnswer> => {
  const byPath = new Map<string, ProposedAnswer>()
  for (const proposal of proposed ?? []) {
    if (byPath.has(proposal.factPath)) {
      throw new Error(`Duplicate proposed answer for ${proposal.factPath}`)
    }
    byPath.set(proposal.factPath, proposal)
  }
  return byPath
}

const optionLabel = (options: readonly FactOption[], value: string): string => {
  const match = options.find((option) => option.value === value)
  if (match === undefined) {
    throw new Error(`Unknown option ${value}`)
  }
  return match.label
}

const displayFactValue = (fact: OpenFact, value: FactValue): string => {
  if (fact.valueKind === 'boolean') {
    if (value === true) {
      return MCP_AIR_FACT_ANSWER_YES_LABEL
    }
    if (value === false) {
      return MCP_AIR_FACT_ANSWER_NO_LABEL
    }
    if (value === null) {
      return MCP_AIR_FACT_ANSWER_NOT_SURE_LABEL
    }
    throw new Error(`Boolean fact ${fact.factPath} answer is not a boolean`)
  }
  if (value === null) {
    return MCP_AIR_FACT_ANSWER_NOT_SURE_LABEL
  }
  if (!Array.isArray(value)) {
    throw new Error(`List fact ${fact.factPath} answer is not a list`)
  }
  return value.map((item) => optionLabel(fact.options, item)).join(', ')
}

const booleanChoice = (fact: OpenFact, value: FactValue): string => {
  if (value === true) {
    return MCP_AIR_FACT_ANSWER_YES
  }
  if (value === false) {
    return MCP_AIR_FACT_ANSWER_NO
  }
  if (value === null) {
    return MCP_AIR_FACT_ANSWER_NOT_SURE
  }
  throw new Error(`Boolean fact ${fact.factPath} answer is not a boolean`)
}

const arrayChoice = (fact: ArrayFact, value: FactValue): readonly string[] => {
  if (value === null) {
    return [MCP_AIR_FACT_ANSWER_NOT_SURE]
  }
  if (Array.isArray(value)) {
    return value
  }
  throw new Error(`List fact ${fact.factPath} answer is not a list`)
}

const fieldDescription = (
  fact: OpenFact,
  proposal: ProposedAnswer | undefined,
  conflict: AnswerConflict | undefined,
): string => {
  const parts = [fact.help]
  if (proposal !== undefined) {
    parts.push(factSuggestionLine(displayFactValue(fact, proposal.value), proposal.reason))
  }
  if (conflict !== undefined) {
    const excerpt = conflict.excerpts.length > 0 ? conflict.excerpts[0] : undefined
    parts.push(
      factConflictLine(
        displayFactValue(fact, conflict.keptValue),
        displayFactValue(fact, conflict.scanValue),
        excerpt,
      ),
    )
  }
  return parts.join(' ')
}

type FormProperty = ElicitRequestFormParams['requestedSchema']['properties'][string]

const formProperty = (
  item: AskItem,
  proposal: ProposedAnswer | undefined,
): FormProperty => {
  const description = fieldDescription(item.fact, proposal, item.conflict)
  const defaultValue = item.conflict !== undefined ? item.conflict.keptValue : proposal?.value
  const hasDefault = item.conflict !== undefined || proposal !== undefined

  if (item.fact.valueKind === 'boolean') {
    return {
      type: 'string',
      title: item.fact.question,
      description,
      enum: [...MCP_AIR_FACT_BOOLEAN_CHOICES],
      enumNames: [...MCP_AIR_FACT_BOOLEAN_CHOICE_LABELS],
      ...(hasDefault && defaultValue !== undefined
        ? { default: booleanChoice(item.fact, defaultValue) }
        : {}),
    }
  }

  return {
    type: 'array',
    title: item.fact.question,
    description,
    items: {
      anyOf: [
        ...item.fact.options.map((option) => ({ const: option.value, title: option.label })),
        { const: MCP_AIR_FACT_ANSWER_NOT_SURE, title: MCP_AIR_FACT_ANSWER_NOT_SURE_LABEL },
      ],
    },
    ...(hasDefault && defaultValue !== undefined
      ? { default: [...arrayChoice(item.fact, defaultValue)] }
      : {}),
  }
}

const buildForm = (
  items: readonly AskItem[],
  proposals: ReadonlyMap<string, ProposedAnswer>,
): ElicitRequestFormParams => {
  const properties: ElicitRequestFormParams['requestedSchema']['properties'] = {}
  const required: string[] = []
  for (const item of items) {
    if (properties[item.fact.factPath] !== undefined) {
      throw new Error(`Duplicate fact path ${item.fact.factPath}`)
    }
    properties[item.fact.factPath] = formProperty(item, proposals.get(item.fact.factPath))
    required.push(item.fact.factPath)
  }
  return {
    message: MCP_AIR_FACT_FORM_MESSAGE,
    requestedSchema: { type: 'object', properties, required },
  }
}

const mapAnswer = (fact: OpenFact, raw: unknown): FactValue => {
  if (fact.valueKind === 'boolean') {
    if (raw === MCP_AIR_FACT_ANSWER_YES) {
      return true
    }
    if (raw === MCP_AIR_FACT_ANSWER_NO) {
      return false
    }
    if (raw === MCP_AIR_FACT_ANSWER_NOT_SURE) {
      return null
    }
    throw new Error(`Unexpected answer for ${fact.factPath}`)
  }
  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string')) {
    throw new Error(`Unexpected answer for ${fact.factPath}`)
  }
  if (raw.includes(MCP_AIR_FACT_ANSWER_NOT_SURE)) {
    return null
  }
  return raw
}

const questionForAgent = (item: AskItem, proposal: ProposedAnswer | undefined) => ({
  factPath: item.fact.factPath,
  question: item.fact.question,
  help: item.fact.help,
  valueKind: item.fact.valueKind,
  ...(item.fact.valueKind === 'array' ? { options: item.fact.options } : {}),
  ...(proposal === undefined ? {} : { proposal }),
  ...(item.conflict === undefined
    ? {}
    : {
        keptValue: item.conflict.keptValue,
        scanValue: item.conflict.scanValue,
        excerpts: item.conflict.excerpts,
      }),
})

const askResult = (payload: OpenFactsPayload, answered: number) => {
  const openFactsRemaining = payload.openFacts.length
  const answerConflictsRemaining = payload.answerConflicts.length
  return {
    answered,
    tier: payload.tier,
    openFactsRemaining,
    answerConflictsRemaining,
    ...(openFactsRemaining > 0 || answerConflictsRemaining > 0
      ? { nextStep: MCP_AIR_MORE_QUESTIONS_NEXT_STEP }
      : {}),
  }
}

export const registerAskOpenFactsTool = (server: McpServer, api: IntegratorApiClient) => {
  server.registerTool(
    'air_ask_open_facts',
    {
      title: MCP_AIR_TOOL_TITLES.air_ask_open_facts,
      description: MCP_AIR_ASK_OPEN_FACTS_DESCRIPTION,
      inputSchema: {
        assessmentPid: z.string(),
        proposedAnswers: z
          .array(
            z.object({
              factPath: z.string(),
              value: z.union([z.boolean(), z.array(z.string()), z.null()]),
              reason: z.string(),
            }),
          )
          .optional(),
      },
      annotations: { ...writeHint, title: MCP_AIR_TOOL_TITLES.air_ask_open_facts },
    },
    async ({ assessmentPid, proposedAnswers }) => {
      try {
        const payload = parseOpenFactsPayload(await api.listOpenFacts(assessmentPid))
        if (payload.openFacts.length === 0 && payload.answerConflicts.length === 0) {
          return toolJsonResult({
            assessmentPid,
            tier: payload.tier,
            openFactsRemaining: 0,
            note: MCP_AIR_NO_OPEN_QUESTIONS_NOTE,
          })
        }

        const proposals = indexProposals(proposedAnswers)
        const items = orderedItems(payload)

        if (!supportsElicitation(server)) {
          return toolJsonResult({
            assessmentPid,
            questions: items.map((item) =>
              questionForAgent(item, proposals.get(item.fact.factPath)),
            ),
            nextStep: MCP_AIR_NO_FORM_NEXT_STEP,
          })
        }

        const formItems = items.slice(0, MCP_AIR_FACT_FORM_MAX_QUESTIONS)
        const result = await server.server.elicitInput(buildForm(formItems, proposals))
        if (result.action !== 'accept' || result.content === undefined) {
          return toolJsonResult({
            assessmentPid,
            declined: true,
            note: MCP_AIR_FACT_FORM_DECLINED_NOTE,
          })
        }

        const answers = formItems.map((item) => ({
          factPath: item.fact.factPath,
          value: mapAnswer(item.fact, result.content?.[item.fact.factPath]),
          justification: MCP_AIR_FACT_FORM_JUSTIFICATION,
        }))
        const submitted = parseOpenFactsPayload(
          await api.submitFactAnswers(assessmentPid, answers),
        )
        return toolJsonResult({
          assessmentPid,
          ...askResult(submitted, answers.length),
        })
      } catch (error) {
        return toolErrorResult(error, 'air_ask_open_facts')
      }
    },
  )
}
