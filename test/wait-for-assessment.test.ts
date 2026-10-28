import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { IntegratorApiClient } from '../src/client/integrator-api.js'
import { createAirMcpServer } from '../src/server.js'

const ASSESSMENT_PID = 'pasm_wait'
const REPORT_URL = 'https://air.example/report'

const stage = (step: number, label: string, status: string) => ({
  stageName: `stage_${step}`,
  label,
  step,
  stepCount: 12,
  status,
})

const connect = async (api: IntegratorApiClient) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createAirMcpServer({ apiUrl: 'http://localhost:4001', apiKey: 'test-key' }, { api })
  const client = new Client({ name: 'wait-test', version: '1.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return client
}

const payload = (result: Awaited<ReturnType<Client['callTool']>>) =>
  JSON.parse(
    (result.content as ReadonlyArray<{ text?: string }>).map((part) => part.text ?? '').join(''),
  ) as Record<string, unknown>

afterEach(() => {
  vi.useRealTimers()
})

describe('air_wait_for_assessment step lines', () => {
  it('says the first step at once on the first wait', async () => {
    const api = {
      getAssessment: vi
        .fn()
        .mockResolvedValue({ pid: ASSESSMENT_PID, status: 'running', reportUrl: REPORT_URL }),
      listAssessmentStages: vi
        .fn()
        .mockResolvedValue([stage(1, 'Reading the documents', 'running')]),
    } as unknown as IntegratorApiClient
    const client = await connect(api)

    const result = payload(
      await client.callTool({
        name: 'air_wait_for_assessment',
        arguments: { assessmentPid: ASSESSMENT_PID },
      }),
    )

    expect(result.ready).toBe(false)
    expect(result.stageLabel).toBe('Step 1 of 12: Reading the documents')
    expect(result.reportUrl).toBe(REPORT_URL)
    expect(api.getAssessment).toHaveBeenCalledTimes(1)
  })

  it('waits past the step it was told was already shown and returns the next one', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    const api = {
      getAssessment: vi
        .fn()
        .mockResolvedValue({ pid: ASSESSMENT_PID, status: 'running', reportUrl: REPORT_URL }),
      listAssessmentStages: vi
        .fn()
        .mockResolvedValueOnce([stage(1, 'Reading the documents', 'running')])
        .mockResolvedValueOnce([
          stage(1, 'Reading the documents', 'completed'),
          stage(2, 'Splitting the evidence into passages', 'running'),
        ]),
    } as unknown as IntegratorApiClient
    const client = await connect(api)

    const pending = client.callTool({
      name: 'air_wait_for_assessment',
      arguments: {
        assessmentPid: ASSESSMENT_PID,
        lastStageLabel: 'Step 1 of 12: Reading the documents',
      },
    })
    await vi.advanceTimersByTimeAsync(6_000)
    const result = payload(await pending)

    expect(result.stageLabel).toBe('Step 2 of 12: Splitting the evidence into passages')
    expect(api.getAssessment).toHaveBeenCalledTimes(2)
  })
})
