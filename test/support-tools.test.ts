import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it, vi } from 'vitest'

import type { IntegratorApiClient } from '../src/client/integrator-api.js'
import {
  IntegratorApiError,
  formatIntegratorApiError,
  humanRetryAfter,
} from '../src/errors.js'
import { createAirMcpServer } from '../src/server.js'

type StubOverrides = {
  readonly apiKey?: string | undefined
  readonly submitFeedback?: ReturnType<typeof vi.fn>
  readonly submitPublicFeedback?: ReturnType<typeof vi.fn>
  readonly requestCredits?: ReturnType<typeof vi.fn>
  readonly creditBalance?: ReturnType<typeof vi.fn>
}

const stubApi = (overrides: StubOverrides = {}) =>
  ({
    resolveApiKey: () => overrides.apiKey,
    submitFeedback:
      overrides.submitFeedback ?? vi.fn().mockResolvedValue({ pid: 'sup_x', received: true }),
    submitPublicFeedback:
      overrides.submitPublicFeedback ?? vi.fn().mockResolvedValue({ received: true }),
    requestCredits:
      overrides.requestCredits ?? vi.fn().mockResolvedValue({ pid: 'sup_y', status: 'open' }),
    creditBalance:
      overrides.creditBalance ??
      vi.fn().mockResolvedValue({
        plan: 'trial',
        credits: { available: 0 },
        canPurchase: true,
      }),
  }) as unknown as IntegratorApiClient

/** A client with no elicitation capability, so the draft is submitted as written. */
const connectWithoutElicitation = async (api: IntegratorApiClient) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createAirMcpServer(
    { apiUrl: 'http://localhost:4001', apiKey: 'test-key' },
    { api },
  )
  const client = new Client({ name: 'support-tools-test', version: '1.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return client
}

const resultText = (result: Awaited<ReturnType<Client['callTool']>>): string => {
  const content = result.content as ReadonlyArray<{ type: string; text?: string }> | undefined
  return content?.map((part) => part.text ?? '').join('\n') ?? ''
}

describe('support tools', () => {
  it('sends authenticated feedback to the account path', async () => {
    const submitFeedback = vi.fn().mockResolvedValue({ pid: 'sup_abc', received: true })
    const submitPublicFeedback = vi.fn()
    const client = await connectWithoutElicitation(
      stubApi({ apiKey: 'air_key', submitFeedback, submitPublicFeedback }),
    )

    const result = await client.callTool({
      name: 'air_submit_feedback',
      arguments: { category: 'bug', message: 'the tier rationale was vague' },
    })

    expect(submitFeedback).toHaveBeenCalledWith({
      category: 'bug',
      message: 'the tier rationale was vague',
    })
    expect(submitPublicFeedback).not.toHaveBeenCalled()
    expect(resultText(result)).toContain('sup_abc')
  })

  it('falls back to the public path when there is no account yet', async () => {
    const submitFeedback = vi.fn()
    const submitPublicFeedback = vi.fn().mockResolvedValue({ received: true })
    const client = await connectWithoutElicitation(
      stubApi({ apiKey: undefined, submitFeedback, submitPublicFeedback }),
    )

    await client.callTool({
      name: 'air_submit_feedback',
      arguments: {
        category: 'bug',
        message: 'signup failed for me',
        contactEmail: 'stranger@example.test',
      },
    })

    expect(submitPublicFeedback).toHaveBeenCalledWith({
      category: 'bug',
      message: 'signup failed for me',
      contactEmail: 'stranger@example.test',
    })
    expect(submitFeedback).not.toHaveBeenCalled()
  })

  it('asks for a contact email when unauthenticated feedback has none', async () => {
    const submitPublicFeedback = vi.fn()
    const client = await connectWithoutElicitation(
      stubApi({ apiKey: undefined, submitPublicFeedback }),
    )

    const result = await client.callTool({
      name: 'air_submit_feedback',
      arguments: { category: 'idea', message: 'no way to reply to me' },
    })

    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('contact email')
    expect(submitPublicFeedback).not.toHaveBeenCalled()
  })

  it('passes a credit request through with its contact email', async () => {
    const requestCredits = vi.fn().mockResolvedValue({ pid: 'sup_credit', status: 'open' })
    const client = await connectWithoutElicitation(stubApi({ apiKey: 'air_key', requestCredits }))

    const result = await client.callTool({
      name: 'air_request_credits',
      arguments: {
        credits: 5,
        reason: 'running a pilot',
        contactEmail: 'owner@acme.test',
      },
    })

    expect(requestCredits).toHaveBeenCalledWith({
      credits: 5,
      reason: 'running a pilot',
      contactEmail: 'owner@acme.test',
    })
    expect(resultText(result)).toContain('sup_credit')
  })

  it('reads the credit balance', async () => {
    const creditBalance = vi.fn().mockResolvedValue({
      plan: 'trial',
      credits: { available: 0 },
      canPurchase: true,
    })
    const client = await connectWithoutElicitation(stubApi({ apiKey: 'air_key', creditBalance }))

    const result = await client.callTool({
      name: 'air_get_credit_balance',
      arguments: {},
    })

    expect(creditBalance).toHaveBeenCalled()
    expect(resultText(result)).toContain('canPurchase')
  })

  it('surfaces the API recovery text on a 402 instead of composing its own', async () => {
    const recovery = 'Request more assessment credits from Thalus, or buy a 5-credit pack.'
    const message = formatIntegratorApiError(
      402,
      JSON.stringify({
        _tag: 'air/InsufficientCreditsError',
        available: 0,
        recovery,
      }),
    )

    expect(message).toContain(recovery)
    expect(message).toContain('air_request_credits')
  })

  it('keeps the generic 402 wording when the API sends no recovery text', () => {
    const message = formatIntegratorApiError(402, JSON.stringify({ _tag: 'air/TrialExpiredError' }))

    expect(message).toContain('Insufficient credits or inactive billing')
  })

  it('reports a 402 through the tool result, recovery text included', async () => {
    const recovery = 'Your free trial has ended. Buy a 5-credit pack or move to the Team plan.'
    const creditBalance = vi
      .fn()
      .mockRejectedValue(
        new IntegratorApiError(402, JSON.stringify({ _tag: 'air/TrialExpiredError', recovery })),
      )
    const client = await connectWithoutElicitation(stubApi({ apiKey: 'air_key', creditBalance }))

    const result = await client.callTool({
      name: 'air_get_credit_balance',
      arguments: {},
    })

    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain(recovery)
  })
})

describe('rate-limit copy', () => {
  it('turns raw seconds into something a person can act on', () => {
    expect(humanRetryAfter(30)).toBe('in under a minute')
    expect(humanRetryAfter(600)).toBe('in about 10 minutes')
    expect(humanRetryAfter(3_600)).toBe('in about 1 hour')
    // The 85178 seconds seen in testing, which is useless rendered literally.
    expect(humanRetryAfter(85_178)).toBe('tomorrow')
    expect(humanRetryAfter(5 * 86_400)).toBe('in about 5 days')
  })

  it('reports a 429 in words, not seconds', () => {
    const message = formatIntegratorApiError(429, JSON.stringify({ retryAfter: 85_178 }))

    expect(message).toContain('tomorrow')
    expect(message).not.toContain('85178')
  })
})
