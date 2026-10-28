import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ElicitRequestFormParams } from '@modelcontextprotocol/sdk/types.js'

import {
  factConflictLine,
  factSuggestionLine,
  MCP_AIR_ANSWER_FIELD_TITLE,
  MCP_AIR_FACT_ANSWER_NO,
  MCP_AIR_FACT_ANSWER_NO_LABEL,
  MCP_AIR_FACT_ANSWER_NONE,
  MCP_AIR_FACT_ANSWER_NONE_LABEL,
  MCP_AIR_FACT_ANSWER_NOT_SURE,
  MCP_AIR_FACT_ANSWER_NOT_SURE_LABEL,
  MCP_AIR_FACT_ANSWER_YES,
  MCP_AIR_FACT_ANSWER_YES_LABEL,
  MCP_AIR_FACT_FORM_TIMEOUT_MS,
} from '../config.js'

/**
 * The form a person answers EU AI Act questions in. Each question is its own dialog.
 * Field keys are fact paths, which the person never sees.
 */

export type FactOption = { readonly value: string; readonly label: string }

export type Question =
  | {
      readonly factPath: string
      readonly question: string
      readonly help: string
      readonly valueKind: 'boolean'
      readonly suggestFromCode: boolean
    }
  | {
      readonly factPath: string
      readonly question: string
      readonly help: string
      readonly valueKind: 'array'
      readonly suggestFromCode: boolean
      readonly options: readonly FactOption[]
    }

export type ScreeningGroup = {
  readonly id: string
  readonly label: string
  readonly factPaths: readonly string[]
}

export type FactValue = boolean | readonly string[] | null

export type FactAnswer = {
  readonly factPath: string
  readonly value: FactValue
}

/** A field's starting value and the line that explains it: a suggestion or an earlier answer. */
export type FieldContext = {
  readonly defaultValue: FactValue
  readonly line: string
}

type FormProperty = ElicitRequestFormParams['requestedSchema']['properties'][string]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readString = (row: Record<string, unknown>, key: string): string => {
  const value = row[key]
  if (typeof value !== 'string') {
    const factPath = typeof row.factPath === 'string' ? row.factPath : '(unknown fact)'
    throw new Error(`Question ${factPath} is missing ${key}`)
  }
  return value
}

export const readQuestion = (raw: unknown): Question => {
  if (!isRecord(raw)) {
    throw new Error('Question is not an object')
  }
  const factPath = readString(raw, 'factPath')
  const question = readString(raw, 'question')
  const help = readString(raw, 'help')
  if (typeof raw.suggestFromCode !== 'boolean') {
    throw new Error(`Question ${factPath} is missing suggestFromCode`)
  }
  const suggestFromCode = raw.suggestFromCode
  if (raw.valueKind === 'boolean') {
    return { factPath, question, help, valueKind: 'boolean', suggestFromCode }
  }
  if (raw.valueKind !== 'array') {
    throw new Error(`Question ${factPath} has unknown valueKind`)
  }
  if (!Array.isArray(raw.options)) {
    throw new Error(`Question ${factPath} is missing options`)
  }
  const options = raw.options.map((option, index) => {
    if (!isRecord(option) || typeof option.value !== 'string' || typeof option.label !== 'string') {
      throw new Error(`Question ${factPath} option ${index} is missing value or label`)
    }
    return { value: option.value, label: option.label }
  })
  return {
    factPath,
    question,
    help,
    valueKind: 'array',
    suggestFromCode,
    options,
  }
}

export const readScreeningGroups = (raw: unknown): readonly ScreeningGroup[] => {
  if (!Array.isArray(raw)) {
    throw new Error('Response is missing screeningGroups')
  }
  return raw.map((group) => {
    if (
      !isRecord(group) ||
      typeof group.id !== 'string' ||
      typeof group.label !== 'string' ||
      !Array.isArray(group.factPaths) ||
      group.factPaths.some((factPath) => typeof factPath !== 'string')
    ) {
      throw new Error('Screening group is missing id, label or factPaths')
    }
    return {
      id: group.id,
      label: group.label,
      factPaths: group.factPaths as string[],
    }
  })
}

export const answerLabel = (question: Question, value: FactValue): string => {
  if (value === null) return MCP_AIR_FACT_ANSWER_NOT_SURE_LABEL
  if (question.valueKind === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new Error(`Answer for ${question.factPath} is not yes or no`)
    }
    return value ? MCP_AIR_FACT_ANSWER_YES_LABEL : MCP_AIR_FACT_ANSWER_NO_LABEL
  }
  if (!Array.isArray(value)) {
    throw new Error(`Answer for ${question.factPath} is not a list`)
  }
  if (value.length === 0) return MCP_AIR_FACT_ANSWER_NONE_LABEL
  return value
    .map((item) => {
      const option = question.options.find((candidate) => candidate.value === item)
      if (option === undefined) {
        throw new Error(`Unknown option ${item} for ${question.factPath}`)
      }
      return option.label
    })
    .join(', ')
}

const booleanChoice = (value: FactValue): string => {
  if (value === true) return MCP_AIR_FACT_ANSWER_YES
  if (value === false) return MCP_AIR_FACT_ANSWER_NO
  if (value === null) return MCP_AIR_FACT_ANSWER_NOT_SURE
  throw new Error('A yes or no answer is a list')
}

const arrayChoice = (value: FactValue): string[] => {
  if (value === null) return [MCP_AIR_FACT_ANSWER_NOT_SURE]
  if (!Array.isArray(value)) throw new Error('A list answer is yes or no')
  return value.length === 0 ? [MCP_AIR_FACT_ANSWER_NONE] : [...value]
}

/**
 * One question as a form field. A list question has an explicit "None of these" and needs at
 * least one choice, so an untouched field can never be read as "none".
 */
export const questionField = (question: Question, context?: FieldContext): FormProperty => {
  const description = context === undefined ? question.help : `${question.help} ${context.line}`
  if (question.valueKind === 'boolean') {
    return {
      type: 'string',
      title: question.question,
      description,
      oneOf: [
        {
          const: MCP_AIR_FACT_ANSWER_YES,
          title: MCP_AIR_FACT_ANSWER_YES_LABEL,
        },
        { const: MCP_AIR_FACT_ANSWER_NO, title: MCP_AIR_FACT_ANSWER_NO_LABEL },
        {
          const: MCP_AIR_FACT_ANSWER_NOT_SURE,
          title: MCP_AIR_FACT_ANSWER_NOT_SURE_LABEL,
        },
      ],
      ...(context === undefined ? {} : { default: booleanChoice(context.defaultValue) }),
    }
  }
  return {
    type: 'array',
    title: question.question,
    description,
    minItems: 1,
    items: {
      anyOf: [
        ...question.options.map((option) => ({
          const: option.value,
          title: option.label,
        })),
        {
          const: MCP_AIR_FACT_ANSWER_NONE,
          title: MCP_AIR_FACT_ANSWER_NONE_LABEL,
        },
        {
          const: MCP_AIR_FACT_ANSWER_NOT_SURE,
          title: MCP_AIR_FACT_ANSWER_NOT_SURE_LABEL,
        },
      ],
    },
    ...(context === undefined ? {} : { default: arrayChoice(context.defaultValue) }),
  }
}

export const readQuestionAnswer = (question: Question, raw: unknown): FactValue => {
  if (question.valueKind === 'boolean') {
    if (raw === MCP_AIR_FACT_ANSWER_YES) return true
    if (raw === MCP_AIR_FACT_ANSWER_NO) return false
    if (raw === MCP_AIR_FACT_ANSWER_NOT_SURE) return null
    throw new Error(`Unexpected answer for "${question.question}"`)
  }
  if (!Array.isArray(raw) || raw.length === 0 || raw.some((entry) => typeof entry !== 'string')) {
    throw new Error(`Unexpected answer for "${question.question}"`)
  }
  const picked = raw as string[]
  if (picked.includes(MCP_AIR_FACT_ANSWER_NOT_SURE)) return null
  if (picked.includes(MCP_AIR_FACT_ANSWER_NONE)) {
    if (picked.length > 1) {
      throw new Error(
        `"${question.question}" has "${MCP_AIR_FACT_ANSWER_NONE_LABEL}" and other options picked. Ask it again.`,
      )
    }
    return []
  }
  return picked
}

export type Asked =
  | { readonly closed: true }
  | { readonly closed: false; readonly value: FactValue }

/**
 * One question in its own dialog. The message is the full question: Claude Code cuts a long
 * choice row, and it shows only the first lines of a message, so the question stays one sentence
 * and the choices stay Yes, No and Not sure.
 */
export const askQuestion = async (
  server: McpServer,
  question: Question,
  context?: FieldContext,
): Promise<Asked> => {
  const content = await askPage(server, question.question, {
    [question.factPath]: {
      ...questionField(question, context),
      title: MCP_AIR_ANSWER_FIELD_TITLE,
    },
  })
  if (content === null) return { closed: true }
  return { closed: false, value: readQuestionAnswer(question, content[question.factPath]) }
}

/** Shows one page. Returns the content, or null when the person closed it. */
export const askPage = async (
  server: McpServer,
  message: string,
  properties: ElicitRequestFormParams['requestedSchema']['properties'],
): Promise<Record<string, unknown> | null> => {
  const result = await server.server.elicitInput(
    {
      message,
      requestedSchema: {
        type: 'object',
        properties,
        required: Object.keys(properties),
      },
    },
    { timeout: MCP_AIR_FACT_FORM_TIMEOUT_MS },
  )
  if (result.action !== 'accept' || result.content === undefined) return null
  return result.content
}

export const suggestionContext = (
  question: Question,
  value: FactValue,
  reason: string,
): FieldContext => ({
  defaultValue: value,
  line: factSuggestionLine(answerLabel(question, value), reason),
})

export const conflictContext = (
  question: Question,
  keptValue: FactValue,
  scanValue: FactValue,
  excerpt: string | undefined,
): FieldContext => ({
  defaultValue: keptValue,
  line: factConflictLine(
    answerLabel(question, keptValue),
    answerLabel(question, scanValue),
    excerpt,
  ),
})
