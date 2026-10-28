import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { IntegratorApiClient } from '../src/client/integrator-api.js'
import { createAirMcpServer } from '../src/server.js'

const ASSESSMENT_PID = 'pasm_ask'
const PROJECT_PID = 'prj_ask'
const JUSTIFICATION = 'Answered in the AIR question form.'
const ANSWER_TITLE = 'Answer'

const EMPLOYMENT = 'data_governance.is_employment_use_case'
const SCORING = 'data_governance.is_social_scoring'
const RIGHTS = 'operational_safety_monitoring.impacts_rights'
const DATA = 'data_governance.data_category'

const employment = {
  factPath: EMPLOYMENT,
  question: 'How is the system used for jobs or workers? Choose all that apply.',
  help: 'Hiring is high-risk.',
  valueKind: 'array',
  suggestFromCode: false,
  options: [
    { value: 'recruitment_selection', label: 'Recruitment or selection' },
    { value: 'termination', label: 'Ending employment' },
  ],
}
const scoring = {
  factPath: SCORING,
  question: 'Does the system score people?',
  help: 'Social scoring can be prohibited.',
  valueKind: 'boolean',
  suggestFromCode: false,
}
const rights = {
  factPath: RIGHTS,
  question: 'Can the output harm people’s rights?',
  help: 'A rights impact keeps it high-risk.',
  valueKind: 'boolean',
  suggestFromCode: false,
}
const data = {
  factPath: DATA,
  question: 'What types of data does the system process?',
  help: 'Biometric data starts the biometric checks.',
  valueKind: 'array',
  suggestFromCode: true,
  options: [
    { value: 'facial_images', label: 'Facial images' },
    { value: 'other', label: 'Other' },
  ],
}
const groups = [
  { id: 'jobs', label: 'Hiring or managing workers', factPaths: [EMPLOYMENT] },
  { id: 'social_scoring', label: 'Scoring people', factPaths: [SCORING] },
]

const tier = (value: string, final: boolean) => ({
  value,
  displayName: value,
  description: value,
  final,
})

const body = (
  openFacts: ReadonlyArray<Record<string, unknown>>,
  options: {
    readonly screeningGroups?: ReadonlyArray<Record<string, unknown>>
    readonly answerConflicts?: ReadonlyArray<Record<string, unknown>>
    readonly tierValue?: string
  } = {},
) => ({
  assessmentPid: ASSESSMENT_PID,
  openFacts,
  screeningGroups: options.screeningGroups ?? [],
  answerConflicts: options.answerConflicts ?? [],
  euAiActTier: {
    available: true,
    tier: tier(options.tierValue ?? 'NA', openFacts.length === 0),
  },
})

type Elicit = {
  readonly message: string
  readonly requestedSchema?: {
    readonly properties: Record<string, Record<string, unknown>>
    readonly required?: readonly string[]
  }
}

type Answer = { action: 'accept' | 'decline'; content?: Record<string, unknown> }

const connect = async (api: IntegratorApiClient, answer?: (page: number) => Answer) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createAirMcpServer(
    { apiUrl: 'http://localhost:4001', apiKey: 'test-key' },
    { api },
  )
  const client = new Client(
    { name: 'ask-test', version: '1.0.0' },
    answer === undefined ? {} : { capabilities: { elicitation: {} } },
  )
  const pages: Elicit[] = []
  if (answer !== undefined) {
    client.setRequestHandler(ElicitRequestSchema, (request) => {
      pages.push(request.params as unknown as Elicit)
      return answer(pages.length)
    })
  }
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return { client, pages }
}

const call = async (client: Client, name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args })
  const text = (result.content as ReadonlyArray<{ text?: string }>)
    .map((part) => part.text ?? '')
    .join('')
  const isError = result.isError === true
  return {
    isError,
    text,
    payload: isError ? {} : (JSON.parse(text) as Record<string, unknown>),
  }
}

const api = (list: unknown, ...submits: unknown[]) => {
  const submitFactAnswers = vi.fn()
  for (const submit of submits) submitFactAnswers.mockResolvedValueOnce(submit)
  const listOpenFacts = vi.fn().mockResolvedValue(list)
  return {
    stub: { listOpenFacts, submitFactAnswers } as unknown as IntegratorApiClient,
    submitFactAnswers,
  }
}

const sent = (...answers: ReadonlyArray<readonly [string, unknown]>) =>
  answers.map(([factPath, value]) => ({ factPath, value, justification: JUSTIFICATION }))

const accept = (content: Record<string, unknown>): Answer => ({ action: 'accept', content })

describe('air_ask_open_facts', () => {
  it('asks each question in its own dialog, with the full question as the message', async () => {
    const { stub, submitFactAnswers } = api(
      body([employment, scoring], { screeningGroups: groups }),
      body([scoring], { screeningGroups: [groups[1]!] }),
      body([], { tierValue: 'MINIMAL' }),
    )
    const { client, pages } = await connect(stub, (page) =>
      page === 1 ? accept({ [EMPLOYMENT]: ['none'] }) : accept({ [SCORING]: 'no' }),
    )

    const { payload } = await call(client, 'air_ask_open_facts', { assessmentPid: ASSESSMENT_PID })

    expect(pages.map((page) => page.message)).toEqual([employment.question, scoring.question])
    expect(pages[0]?.requestedSchema?.properties[EMPLOYMENT]).toMatchObject({
      title: ANSWER_TITLE,
      description: employment.help,
    })
    expect(submitFactAnswers.mock.calls).toEqual([
      [ASSESSMENT_PID, sent([EMPLOYMENT, []])],
      [ASSESSMENT_PID, sent([SCORING, false])],
    ])
    expect(payload).toMatchObject({ answered: 2, openFactsRemaining: 0, notSureFactPaths: [] })
    expect(payload.nextStep).toBeUndefined()
  })

  it('asks a list question with its options after the yes/no question', async () => {
    const { stub, submitFactAnswers } = api(
      body([scoring, employment], { screeningGroups: groups }),
      body([employment], { screeningGroups: [groups[0]!] }),
      body([], { tierValue: 'HIGH' }),
    )
    const { client, pages } = await connect(stub, (page) =>
      page === 1 ? accept({ [SCORING]: 'yes' }) : accept({ [EMPLOYMENT]: ['recruitment_selection'] }),
    )

    await call(client, 'air_ask_open_facts', { assessmentPid: ASSESSMENT_PID })

    expect(pages.map((page) => page.message)).toEqual([scoring.question, employment.question])
    expect(pages[1]?.requestedSchema?.properties[EMPLOYMENT]).toEqual({
      type: 'array',
      title: ANSWER_TITLE,
      description: employment.help,
      minItems: 1,
      items: {
        anyOf: [
          { const: 'recruitment_selection', title: 'Recruitment or selection' },
          { const: 'termination', title: 'Ending employment' },
          { const: 'none', title: 'None of these' },
          { const: 'not_sure', title: 'Not sure' },
        ],
      },
    })
    expect(submitFactAnswers.mock.calls).toEqual([
      [ASSESSMENT_PID, sent([SCORING, true])],
      [ASSESSMENT_PID, sent([EMPLOYMENT, ['recruitment_selection']])],
    ])
  })

  it('refuses a list answer with no choice instead of reading it as none', async () => {
    const { stub, submitFactAnswers } = api(body([employment], { screeningGroups: [groups[0]!] }))
    const { client } = await connect(stub, () => accept({ [EMPLOYMENT]: [] }))

    const result = await call(client, 'air_ask_open_facts', { assessmentPid: ASSESSMENT_PID })

    expect(result.isError).toBe(true)
    expect(result.text).toContain(`${EMPLOYMENT} must NOT have fewer than 1 items`)
    expect(submitFactAnswers).not.toHaveBeenCalled()
  })

  it('refuses "None of these" picked together with another option', async () => {
    const { stub, submitFactAnswers } = api(body([employment], { screeningGroups: [groups[0]!] }))
    const { client } = await connect(stub, () =>
      accept({ [EMPLOYMENT]: ['none', 'recruitment_selection'] }),
    )

    const result = await call(client, 'air_ask_open_facts', { assessmentPid: ASSESSMENT_PID })

    expect(result.isError).toBe(true)
    expect(result.text).toContain('None of these')
    expect(submitFactAnswers).not.toHaveBeenCalled()
  })

  it('asks the next question after one answer is saved', async () => {
    const { stub, submitFactAnswers } = api(
      body([employment, scoring], { screeningGroups: groups }),
      body([scoring], { screeningGroups: [groups[1]!] }),
      body([], { tierValue: 'MINIMAL' }),
    )
    const { client, pages } = await connect(stub, (page) =>
      page === 1 ? accept({ [EMPLOYMENT]: ['none'] }) : accept({ [SCORING]: 'no' }),
    )

    await call(client, 'air_ask_open_facts', { assessmentPid: ASSESSMENT_PID })

    expect(pages.map((page) => page.message)).toEqual([employment.question, scoring.question])
    expect(submitFactAnswers.mock.calls).toEqual([
      [ASSESSMENT_PID, sent([EMPLOYMENT, []])],
      [ASSESSMENT_PID, sent([SCORING, false])],
    ])
  })

  it('stops when every open question is "Not sure", and returns them to skip next time', async () => {
    const { stub, submitFactAnswers } = api(
      body([rights], { tierValue: 'HIGH' }),
      body([rights], { tierValue: 'HIGH' }),
    )
    const { client, pages } = await connect(stub, () => accept({ [RIGHTS]: 'not_sure' }))

    const { payload } = await call(client, 'air_ask_open_facts', { assessmentPid: ASSESSMENT_PID })

    expect(pages).toHaveLength(1)
    expect(submitFactAnswers.mock.calls).toEqual([[ASSESSMENT_PID, sent([RIGHTS, null])]])
    expect(payload).toMatchObject({
      openFactsRemaining: 1,
      notSureFactPaths: [RIGHTS],
      stillOpen: [rights.question],
    })
    expect(payload.nextStep).toBeUndefined()
  })

  it('shows no form for questions already answered "Not sure"', async () => {
    const { stub } = api(body([rights], { tierValue: 'HIGH' }))
    const { client, pages } = await connect(stub, () => ({ action: 'decline' }))

    const { payload } = await call(client, 'air_ask_open_facts', {
      assessmentPid: ASSESSMENT_PID,
      skipFactPaths: [RIGHTS],
    })

    expect(pages).toHaveLength(0)
    expect(payload).toEqual({
      assessmentPid: ASSESSMENT_PID,
      tier: tier('HIGH', false),
      openFactsRemaining: 1,
    })
  })

  it('asks the follow-ups the checklist opened, in the same call', async () => {
    const { stub, submitFactAnswers } = api(
      body([scoring], { screeningGroups: [groups[1]!] }),
      body([rights], { tierValue: 'HIGH' }),
      body([], { tierValue: 'HIGH' }),
    )
    const { client, pages } = await connect(stub, (page) =>
      page === 1 ? accept({ [SCORING]: 'yes' }) : accept({ [RIGHTS]: 'yes' }),
    )

    const { payload } = await call(client, 'air_ask_open_facts', { assessmentPid: ASSESSMENT_PID })

    expect(pages.map((page) => page.message)).toEqual([scoring.question, rights.question])
    expect(submitFactAnswers.mock.calls).toEqual([
      [ASSESSMENT_PID, sent([SCORING, true])],
      [ASSESSMENT_PID, sent([RIGHTS, true])],
    ])
    expect(payload).toMatchObject({ answered: 2, openFactsRemaining: 0 })
  })

  it('refuses a suggestion for what the system is used for', async () => {
    const { stub } = api(body([rights]))
    const { client, pages } = await connect(stub, () => ({ action: 'decline' }))

    const result = await call(client, 'air_ask_open_facts', {
      assessmentPid: ASSESSMENT_PID,
      proposedAnswers: [{ factPath: RIGHTS, value: false, reason: 'It is a chat app.' }],
    })

    expect(result.isError).toBe(true)
    expect(result.text).toContain(`"${rights.question}" must come from the person`)
    expect(pages).toHaveLength(0)
  })

  it('starts a fact the code can show with its suggestion and says so', async () => {
    const { stub } = api(body([data]), body([]))
    const { client, pages } = await connect(stub, () => accept({ [DATA]: ['other'] }))

    await call(client, 'air_ask_open_facts', {
      assessmentPid: ASSESSMENT_PID,
      proposedAnswers: [{ factPath: DATA, value: ['other'], reason: 'The prompt is chat text.' }],
    })

    expect(pages[0]?.message).toBe(data.question)
    expect(pages[0]?.requestedSchema?.properties[DATA]).toMatchObject({
      title: ANSWER_TITLE,
      default: ['other'],
      description: `${data.help} Suggested from your code: Other (The prompt is chat text.)`,
    })
  })

  it('starts a conflict at the earlier answer and quotes what the scan read', async () => {
    const conflict = {
      ...scoring,
      keptValue: false,
      scanValue: true,
      excerpts: ['We rank users by behaviour.'],
    }
    const { stub, submitFactAnswers } = api(body([], { answerConflicts: [conflict] }), body([]))
    const { client, pages } = await connect(stub, () => accept({ [SCORING]: 'no' }))

    await call(client, 'air_ask_open_facts', { assessmentPid: ASSESSMENT_PID })

    expect(pages[0]?.message).toBe(scoring.question)
    expect(pages[0]?.requestedSchema?.properties[SCORING]).toEqual({
      type: 'string',
      title: ANSWER_TITLE,
      description: `${scoring.help} You answered No before. This scan read Yes: "We rank users by behaviour."`,
      oneOf: [
        { const: 'yes', title: 'Yes' },
        { const: 'no', title: 'No' },
        { const: 'not_sure', title: 'Not sure' },
      ],
      default: 'no',
    })
    expect(submitFactAnswers.mock.calls).toEqual([[ASSESSMENT_PID, sent([SCORING, false])]])
  })

  it('saves nothing when the person closes the first page', async () => {
    const { stub, submitFactAnswers } = api(
      body([employment, scoring], { screeningGroups: groups }),
    )
    const { client } = await connect(stub, () => ({ action: 'decline' }))

    const { payload } = await call(client, 'air_ask_open_facts', { assessmentPid: ASSESSMENT_PID })

    expect(submitFactAnswers).not.toHaveBeenCalled()
    expect(payload).toMatchObject({ declined: true, answered: 0 })
  })

  it('returns the checklist and questions when the client cannot show a form', async () => {
    const { stub, submitFactAnswers } = api(
      body([employment, scoring], { screeningGroups: groups }),
    )
    const { client } = await connect(stub)

    const { payload } = await call(client, 'air_ask_open_facts', { assessmentPid: ASSESSMENT_PID })

    expect(payload.checklist).toEqual(groups)
    expect(
      (payload.questions as ReadonlyArray<{ factPath: string }>).map(
        (question) => question.factPath,
      ),
    ).toEqual([EMPLOYMENT, SCORING])
    expect(submitFactAnswers).not.toHaveBeenCalled()
  })
})

describe('form timing', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the form open while the person takes more than a minute', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { stub, submitFactAnswers } = api(
      body([scoring], { screeningGroups: [groups[1]!] }),
      body([], { tierValue: 'MINIMAL' }),
    )
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = createAirMcpServer(
      { apiUrl: 'http://localhost:4001', apiKey: 'test-key' },
      { api: stub },
    )
    const client = new Client(
      { name: 'slow-person', version: '1.0.0' },
      { capabilities: { elicitation: {} } },
    )
    client.setRequestHandler(
      ElicitRequestSchema,
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ action: 'accept', content: { [SCORING]: 'no' } }), 120_000)
        }),
    )
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    // Claude Code waits for a tool call far longer than the SDK's 60-second request default.
    const pending = client.callTool(
      { name: 'air_ask_open_facts', arguments: { assessmentPid: ASSESSMENT_PID } },
      undefined,
      { timeout: 600_000 },
    )
    await vi.advanceTimersByTimeAsync(121_000)
    const result = await pending

    expect(result.isError).not.toBe(true)
    expect(submitFactAnswers.mock.calls).toEqual([[ASSESSMENT_PID, sent([SCORING, false])]])
  })
})

describe('air_ask_screening_questions', () => {
  it('holds the checklist answers for after the scan starts and saves nothing', async () => {
    const listScreeningQuestions = vi
      .fn()
      .mockResolvedValue({ screeningGroups: groups, questions: [employment, scoring] })
    const savePreparedAnswers = vi.fn()
    const stub = { listScreeningQuestions, savePreparedAnswers } as unknown as IntegratorApiClient
    const { client } = await connect(stub, (page) =>
      page === 1
        ? accept({ [EMPLOYMENT]: ['recruitment_selection', 'termination'] })
        : accept({ [SCORING]: 'no' }),
    )

    const { payload } = await call(client, 'air_ask_screening_questions', {
      projectPid: PROJECT_PID,
    })

    expect(listScreeningQuestions).toHaveBeenCalledWith(PROJECT_PID)
    expect(savePreparedAnswers).not.toHaveBeenCalled()
    expect(payload.answers).toEqual([
      {
        factPath: EMPLOYMENT,
        value: ['recruitment_selection', 'termination'],
        question: employment.question,
        answer: 'Recruitment or selection, Ending employment',
      },
      { factPath: SCORING, value: false, question: scoring.question, answer: 'No' },
    ])
  })
})
