import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it, vi } from 'vitest'

import type { IntegratorApiClient } from '../src/client/integrator-api.js'
import { createAirMcpServer } from '../src/server.js'

const ASSESSMENT_PID = 'pasm_ask'
const FORM_MESSAGE =
  'Answer these questions so AIR can set the EU AI Act tier. Suggestions come from your code; change any that are wrong. Choose "Not sure" if you do not know; that question stays open.'
const FORM_JUSTIFICATION = 'Answered in the AIR question form.'

type OpenFactsBody = Record<string, unknown>

const tier = (value: string, final: boolean) => ({
  value,
  displayName: value,
  description: `${value} tier`,
  final,
})

const openFactsBody = (
  openFacts: ReadonlyArray<Record<string, unknown>>,
  answerConflicts: ReadonlyArray<Record<string, unknown>> = [],
  tierValue = 'HIGH',
): OpenFactsBody => ({
  assessmentPid: ASSESSMENT_PID,
  openFacts,
  answerConflicts,
  euAiActTier: { available: true, tier: tier(tierValue, openFacts.length === 0 && answerConflicts.length === 0) },
})

const booleanFact = (factPath: string, question = `Question ${factPath}`, help = `Help ${factPath}`) => ({
  factPath,
  question,
  help,
  valueKind: 'boolean',
})

const arrayFact = (
  factPath: string,
  options: ReadonlyArray<{ value: string; label: string }>,
  question = `Question ${factPath}`,
  help = `Help ${factPath}`,
) => ({
  factPath,
  question,
  help,
  valueKind: 'array',
  options,
})

const booleanConflict = (
  factPath: string,
  keptValue: boolean | null,
  scanValue: boolean | null,
  excerpts: readonly string[],
  question = `Question ${factPath}`,
  help = `Help ${factPath}`,
) => ({
  ...booleanFact(factPath, question, help),
  keptValue,
  scanValue,
  excerpts,
})

const resultJson = (result: Awaited<ReturnType<Client['callTool']>>) => {
  const content = result.content as ReadonlyArray<{ type: string; text?: string }>
  return {
    isError: result.isError === true,
    payload: JSON.parse(content.map((part) => part.text ?? '').join('')) as Record<string, unknown>,
  }
}

const connect = async (
  api: IntegratorApiClient,
  options: {
    readonly elicitation?: boolean
    readonly onElicit?: (params: {
      readonly message: string
      readonly requestedSchema?: {
        readonly properties: Record<string, unknown>
        readonly required?: readonly string[]
      }
    }) => { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }
  } = {},
) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createAirMcpServer(
    { apiUrl: 'http://localhost:4001', apiKey: 'test-key' },
    { api },
  )
  const client = new Client(
    { name: 'ask-open-facts-test', version: '1.0.0' },
    options.elicitation === true ? { capabilities: { elicitation: {} } } : {},
  )
  if (options.onElicit !== undefined) {
    client.setRequestHandler(ElicitRequestSchema, (request) => options.onElicit?.(request.params) ?? {
      action: 'cancel' as const,
    })
  }
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return client
}

const stubApi = (
  listBody: OpenFactsBody,
  submitBody: OpenFactsBody = listBody,
) => {
  const listOpenFacts = vi.fn().mockResolvedValue(listBody)
  const submitFactAnswers = vi.fn().mockResolvedValue(submitBody)
  const api = { listOpenFacts, submitFactAnswers } as unknown as IntegratorApiClient
  return { api, listOpenFacts, submitFactAnswers }
}

const domainOptions = [
  { value: 'employment', label: 'Employment' },
  { value: 'credit', label: 'Credit' },
]

describe('air_ask_open_facts', () => {
  it('builds one form for a boolean and a list, with suggestion defaults', async () => {
    let asked:
      | {
          message: string
          requestedSchema?: { properties: Record<string, unknown>; required?: readonly string[] }
        }
      | undefined
    const { api, submitFactAnswers } = stubApi(
      openFactsBody([
        booleanFact('facts.decides', 'Does it decide?', 'It can raise the tier.'),
        arrayFact('facts.domains', domainOptions, 'Which domains?', 'The domain can change the tier.'),
        booleanFact('facts.gap', 'Is there a gap?', 'A gap stays open.'),
      ]),
    )
    const client = await connect(api, {
      elicitation: true,
      onElicit: (params) => {
        asked = params
        return { action: 'decline' }
      },
    })

    await client.callTool({
      name: 'air_ask_open_facts',
      arguments: {
        assessmentPid: ASSESSMENT_PID,
        proposedAnswers: [
          { factPath: 'facts.decides', value: true, reason: 'the scorer ranks applicants' },
          {
            factPath: 'facts.domains',
            value: ['employment', 'credit'],
            reason: 'both routes are present',
          },
          { factPath: 'facts.gap', value: null, reason: 'the code does not say' },
        ],
      },
    })

    expect(asked?.message).toBe(FORM_MESSAGE)
    expect(asked?.requestedSchema?.properties['facts.decides']).toEqual({
      type: 'string',
      title: 'Does it decide?',
      description:
        'It can raise the tier. Suggested from your code: Yes (the scorer ranks applicants)',
      enum: ['yes', 'no', 'not_sure'],
      enumNames: ['Yes', 'No', 'Not sure'],
      default: 'yes',
    })
    expect(asked?.requestedSchema?.properties['facts.domains']).toEqual({
      type: 'array',
      title: 'Which domains?',
      description:
        'The domain can change the tier. Suggested from your code: Employment, Credit (both routes are present)',
      items: {
        anyOf: [
          { const: 'employment', title: 'Employment' },
          { const: 'credit', title: 'Credit' },
          { const: 'not_sure', title: 'Not sure' },
        ],
      },
      default: ['employment', 'credit'],
    })
    expect(asked?.requestedSchema?.properties['facts.gap']).toEqual({
      type: 'string',
      title: 'Is there a gap?',
      description: 'A gap stays open. Suggested from your code: Not sure (the code does not say)',
      enum: ['yes', 'no', 'not_sure'],
      enumNames: ['Yes', 'No', 'Not sure'],
      default: 'not_sure',
    })
    expect(submitFactAnswers).not.toHaveBeenCalled()
  })

  it('describes a conflict with the kept answer as the default', async () => {
    let properties: Record<string, { description?: string; default?: unknown }> = {}
    const { api } = stubApi(
      openFactsBody(
        [],
        [
          booleanConflict(
            'facts.review',
            true,
            false,
            ['the model scores applicants'],
            'Did a person review it?',
            'Earlier answer differs.',
          ),
          {
            ...arrayFact('facts.domains', domainOptions, 'Which domains?', 'Domain differs.'),
            keptValue: ['employment'],
            scanValue: ['credit'],
            excerpts: [],
          },
          booleanConflict('facts.unknown', false, null, [], 'Was it unknown?', 'No excerpt.'),
        ],
      ),
    )
    const client = await connect(api, {
      elicitation: true,
      onElicit: (params) => {
        properties = params.requestedSchema?.properties as typeof properties
        return { action: 'cancel' }
      },
    })

    await client.callTool({
      name: 'air_ask_open_facts',
      arguments: {
        assessmentPid: ASSESSMENT_PID,
        proposedAnswers: [{ factPath: 'facts.review', value: false, reason: 'looks like a no' }],
      },
    })

    expect(properties['facts.review']?.description).toBe(
      'Earlier answer differs. Suggested from your code: No (looks like a no) You answered Yes before. This scan read No: "the model scores applicants"',
    )
    expect(properties['facts.review']?.default).toBe('yes')
    expect(properties['facts.domains']?.description).toBe(
      'Domain differs. You answered Employment before. This scan read Credit.',
    )
    expect(properties['facts.domains']?.default).toEqual(['employment'])
    expect(properties['facts.unknown']?.description).toBe(
      'No excerpt. You answered No before. This scan read Not sure.',
    )
  })

  it('maps form answers and submits only those questions', async () => {
    const list = openFactsBody([
      booleanFact('facts.yes'),
      booleanFact('facts.no'),
      booleanFact('facts.unsure'),
      arrayFact('facts.some', [
        { value: 'alpha', label: 'Alpha' },
        { value: 'beta', label: 'Beta' },
      ]),
      arrayFact('facts.none', [{ value: 'alpha', label: 'Alpha' }]),
      arrayFact('facts.unsure_list', [{ value: 'alpha', label: 'Alpha' }]),
      arrayFact('facts.mixed', [{ value: 'employment', label: 'Employment' }]),
    ])
    const submittedBody = openFactsBody([booleanFact('facts.later')], [], 'LIMITED')
    const { api, listOpenFacts, submitFactAnswers } = stubApi(list, submittedBody)
    const content = {
      'facts.yes': 'yes',
      'facts.no': 'no',
      'facts.unsure': 'not_sure',
      'facts.some': ['alpha', 'beta'],
      'facts.none': [],
      'facts.unsure_list': ['not_sure'],
      'facts.mixed': ['employment', 'not_sure'],
    }
    const client = await connect(api, {
      elicitation: true,
      onElicit: () => ({ action: 'accept', content }),
    })

    const { isError, payload } = resultJson(
      await client.callTool({ name: 'air_ask_open_facts', arguments: { assessmentPid: ASSESSMENT_PID } }),
    )

    expect(isError).toBe(false)
    expect(listOpenFacts).toHaveBeenCalledTimes(1)
    expect(listOpenFacts).toHaveBeenCalledWith(ASSESSMENT_PID)
    expect(submitFactAnswers).toHaveBeenCalledTimes(1)
    expect(submitFactAnswers).toHaveBeenCalledWith(ASSESSMENT_PID, [
      { factPath: 'facts.yes', value: true, justification: FORM_JUSTIFICATION },
      { factPath: 'facts.no', value: false, justification: FORM_JUSTIFICATION },
      { factPath: 'facts.unsure', value: null, justification: FORM_JUSTIFICATION },
      { factPath: 'facts.some', value: ['alpha', 'beta'], justification: FORM_JUSTIFICATION },
      { factPath: 'facts.none', value: [], justification: FORM_JUSTIFICATION },
      { factPath: 'facts.unsure_list', value: null, justification: FORM_JUSTIFICATION },
      { factPath: 'facts.mixed', value: null, justification: FORM_JUSTIFICATION },
    ])
    expect(listOpenFacts.mock.invocationCallOrder[0]).toBeLessThan(
      submitFactAnswers.mock.invocationCallOrder[0] ?? 0,
    )
    expect(payload).toEqual({
      assessmentPid: ASSESSMENT_PID,
      answered: 7,
      tier: tier('LIMITED', false),
      openFactsRemaining: 1,
      answerConflictsRemaining: 0,
      nextStep:
        'More questions are open, and their answers can still change the tier. Call air_ask_open_facts again.',
    })
  })

  it('does not submit when the person declines the form', async () => {
    const { api, submitFactAnswers } = stubApi(openFactsBody([booleanFact('facts.one')]))
    const client = await connect(api, {
      elicitation: true,
      onElicit: () => ({ action: 'decline' }),
    })

    const { isError, payload } = resultJson(
      await client.callTool({ name: 'air_ask_open_facts', arguments: { assessmentPid: ASSESSMENT_PID } }),
    )

    expect(isError).toBe(false)
    expect(submitFactAnswers).not.toHaveBeenCalled()
    expect(payload).toEqual({
      assessmentPid: ASSESSMENT_PID,
      declined: true,
      note: 'The person closed the form. Do not ask these questions again unless they ask.',
    })
  })

  it('returns the questions when the client cannot show a form', async () => {
    const { api, submitFactAnswers } = stubApi(
      openFactsBody(
        [arrayFact('facts.domains', domainOptions, 'Which domains?', 'The domain can change the tier.')],
        [
          booleanConflict(
            'facts.kept',
            null,
            true,
            ['saw a score'],
            'Did a person review it?',
            'A review can lower the tier.',
          ),
        ],
      ),
    )
    const client = await connect(api)

    const { isError, payload } = resultJson(
      await client.callTool({
        name: 'air_ask_open_facts',
        arguments: {
          assessmentPid: ASSESSMENT_PID,
          proposedAnswers: [
            { factPath: 'facts.domains', value: ['employment'], reason: 'hiring route' },
          ],
        },
      }),
    )

    expect(isError).toBe(false)
    expect(submitFactAnswers).not.toHaveBeenCalled()
    expect(payload).toEqual({
      assessmentPid: ASSESSMENT_PID,
      questions: [
        {
          factPath: 'facts.kept',
          question: 'Did a person review it?',
          help: 'A review can lower the tier.',
          valueKind: 'boolean',
          keptValue: null,
          scanValue: true,
          excerpts: ['saw a score'],
        },
        {
          factPath: 'facts.domains',
          question: 'Which domains?',
          help: 'The domain can change the tier.',
          valueKind: 'array',
          options: domainOptions,
          proposal: {
            factPath: 'facts.domains',
            value: ['employment'],
            reason: 'hiring route',
          },
        },
      ],
      nextStep:
        'This client cannot show a form. Ask the person these questions in chat: use the question and help text, offer the options by label, and add "Not sure". Then call air_submit_fact_answers.',
    })
  })

  it('asks only the first 10 questions, conflicts first', async () => {
    const conflicts = Array.from({ length: 4 }, (_, index) =>
      booleanConflict(`facts.conflict_${index}`, true, false, []),
    )
    const facts = Array.from({ length: 8 }, (_, index) => booleanFact(`facts.open_${index}`))
    const expectedPaths = [
      ...conflicts.map((row) => row.factPath),
      ...facts.slice(0, 6).map((row) => row.factPath),
    ]
    let required: readonly string[] = []
    const { api, submitFactAnswers } = stubApi(
      openFactsBody(facts, conflicts),
      openFactsBody([], [], 'MINIMAL'),
    )
    const client = await connect(api, {
      elicitation: true,
      onElicit: (params) => {
        required = params.requestedSchema?.required ?? []
        const content = Object.fromEntries(required.map((factPath) => [factPath, 'not_sure']))
        return { action: 'accept', content }
      },
    })

    const { payload } = resultJson(
      await client.callTool({ name: 'air_ask_open_facts', arguments: { assessmentPid: ASSESSMENT_PID } }),
    )

    expect(required).toEqual(expectedPaths)
    expect(required).toHaveLength(10)
    expect(submitFactAnswers).toHaveBeenCalledWith(
      ASSESSMENT_PID,
      expectedPaths.map((factPath) => ({
        factPath,
        value: null,
        justification: FORM_JUSTIFICATION,
      })),
    )
    expect(payload).toEqual({
      assessmentPid: ASSESSMENT_PID,
      answered: 10,
      tier: tier('MINIMAL', true),
      openFactsRemaining: 0,
      answerConflictsRemaining: 0,
    })
    expect(payload).not.toHaveProperty('nextStep')
  })

  it('reports a final tier when nothing is open', async () => {
    let elicitCalls = 0
    const { api, listOpenFacts, submitFactAnswers } = stubApi(openFactsBody([], [], 'MINIMAL'))
    const client = await connect(api, {
      elicitation: true,
      onElicit: () => {
        elicitCalls += 1
        return { action: 'accept', content: {} }
      },
    })

    const { isError, payload } = resultJson(
      await client.callTool({ name: 'air_ask_open_facts', arguments: { assessmentPid: ASSESSMENT_PID } }),
    )

    expect(isError).toBe(false)
    expect(elicitCalls).toBe(0)
    expect(listOpenFacts).toHaveBeenCalledTimes(1)
    expect(submitFactAnswers).not.toHaveBeenCalled()
    expect(payload).toEqual({
      assessmentPid: ASSESSMENT_PID,
      tier: tier('MINIMAL', true),
      openFactsRemaining: 0,
      note: 'No open questions. The tier is final.',
    })
  })
})
