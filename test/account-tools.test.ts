import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it, vi } from 'vitest'

import type { IntegratorApiClient } from '../src/client/integrator-api.js'
import { MCP_AIR_PORTAL_SIGNUP_URL } from '../src/config.js'
import { createAirMcpServer } from '../src/server.js'
import { MCP_AIR_SIGNUP_FORM_URI } from '../src/tools/account.js'
import { MCP_AIR_PUBLIC_TOOL_NAMES } from '../src/surface.js'

const UI_EXTENSION_ID = 'io.modelcontextprotocol/ui'

const stubApi = (overrides: Record<string, unknown> = {}) =>
  ({
    resolveApiKey: () => undefined,
    agentSignup: vi.fn(),
    agentVerifyEmail: vi.fn(),
    ...overrides,
  }) as unknown as IntegratorApiClient

/** `capabilities.extensions` is how a client declares MCP Apps support. */
const connect = async (api: IntegratorApiClient, withApps: boolean) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createAirMcpServer(
    { apiUrl: 'http://localhost:4001', apiKey: 'test-key' },
    { api },
  )
  const client = new Client(
    { name: 'account-tools-test', version: '1.0.0' },
    withApps ? { capabilities: { extensions: { [UI_EXTENSION_ID]: {} } } } : {},
  )
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return client
}

const resultJson = (result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> => {
  const content = result.content as ReadonlyArray<{ type: string; text?: string }> | undefined
  const text = content?.find((part) => part.type === 'text')?.text ?? '{}'
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return { text }
  }
}

const resultText = (result: Awaited<ReturnType<Client['callTool']>>): string => {
  const content = result.content as ReadonlyArray<{ type: string; text?: string }> | undefined
  return content?.map((part) => part.text ?? '').join('\n') ?? ''
}

describe('signup form resource', () => {
  it('serves an MCP App document with the runtime inlined', async () => {
    const client = await connect(stubApi(), true)

    const resource = await client.readResource({ uri: MCP_AIR_SIGNUP_FORM_URI })
    const entry = resource.contents[0] as { mimeType?: string; text?: string }

    expect(entry.mimeType).toBe('text/html;profile=mcp-app')
    const html = entry.text ?? ''
    expect(html).toContain('<script type="module">')
    expect(html).toContain('new App(')
    expect(html).toContain('callServerTool')
    // No bundler runs, so a bare import inside the iframe would simply fail.
    expect(html).not.toMatch(/^\s*import\s+[^(]*from\s+['"][a-z@]/m)
  })

  it('collects the terms tick in the form and nowhere else', async () => {
    const client = await connect(stubApi(), true)

    const resource = await client.readResource({ uri: MCP_AIR_SIGNUP_FORM_URI })
    const html = (resource.contents[0] as { text?: string }).text ?? ''

    expect(html).toContain('id="terms" type="checkbox"')
    expect(html).toContain("acceptTerms: $('terms').checked")
    // The link is whatever the server reported, never a URL guessed here.
    expect(html).toContain("$('terms-link').href = session.termsUrl")
  })
})

describe('air_create_account', () => {
  it('hides the form callbacks from the model and keeps the entry tool visible', async () => {
    const client = await connect(stubApi(), true)

    const { tools } = await client.listTools()
    const meta = (name: string) =>
      (
        tools.find((tool) => tool.name === name)?._meta as
          { ui?: { resourceUri?: string; visibility?: ReadonlyArray<string> } } | undefined
      )?.ui

    expect(meta('air_create_account')?.resourceUri).toBe(MCP_AIR_SIGNUP_FORM_URI)
    expect(meta('air_create_account')?.visibility).toBeUndefined()
    expect(meta('air_signup_send_code')?.visibility).toEqual(['app'])
    expect(meta('air_signup_verify_code')?.visibility).toEqual(['app'])
  })

  it('sends the person to the portal when the client cannot show a form', async () => {
    const client = await connect(stubApi(), false)

    const result = await client.callTool({ name: 'air_create_account', arguments: {} })

    // Never ask the model for the details instead.
    expect(resultText(result)).toContain(MCP_AIR_PORTAL_SIGNUP_URL)
  })

  it('opens the form when the client supports MCP Apps', async () => {
    const client = await connect(stubApi(), true)

    const result = await client.callTool({ name: 'air_create_account', arguments: {} })

    expect(resultJson(result).status).toBe('form_open')
  })

  it('is reachable without a credential, along with its form callbacks', () => {
    expect(MCP_AIR_PUBLIC_TOOL_NAMES).toContain('air_create_account')
    expect(MCP_AIR_PUBLIC_TOOL_NAMES).toContain('air_signup_send_code')
    expect(MCP_AIR_PUBLIC_TOOL_NAMES).toContain('air_signup_verify_code')
  })
})

describe('signup callbacks', () => {
  it('passes the server-reported terms version back on verify', async () => {
    const agentSignup = vi.fn().mockResolvedValue({
      signupPid: 'sgn_x',
      continuationToken: 'tok_x',
      step: 'verify_email',
      otpSentTo: 'p•••@acme.test',
      termsVersion: '2026-06-15',
      termsUrl: 'https://air.thalus.ai/legal/terms',
    })
    const agentVerifyEmail = vi.fn().mockResolvedValue({
      status: 'ready',
      orgSlug: 'acme',
      domainPid: 'dom_x',
      domainSlug: 'acme',
      credits: 1,
      signInUrl: 'https://air.thalus.ai/auth/one-time/abc',
    })
    const client = await connect(stubApi({ agentSignup, agentVerifyEmail }), true)

    const started = resultJson(
      await client.callTool({
        name: 'air_signup_send_code',
        arguments: { name: 'A Person', email: 'person@acme.test', orgName: 'Acme' },
      }),
    )
    expect(started.termsVersion).toBe('2026-06-15')
    expect(started.termsUrl).toBe('https://air.thalus.ai/legal/terms')

    const done = resultJson(
      await client.callTool({
        name: 'air_signup_verify_code',
        arguments: {
          continuationToken: 'tok_x',
          otp: '123456',
          termsVersion: '2026-06-15',
          acceptTerms: true,
        },
      }),
    )

    expect(agentVerifyEmail).toHaveBeenCalledWith({
      continuationToken: 'tok_x',
      otp: '123456',
      termsVersion: '2026-06-15',
      acceptTerms: true,
    })
    expect(done.signInUrl).toBe('https://air.thalus.ai/auth/one-time/abc')
  })

  it('refuses to create the account when the terms were not ticked', async () => {
    const agentVerifyEmail = vi.fn()
    const client = await connect(stubApi({ agentVerifyEmail }), true)

    const result = await client.callTool({
      name: 'air_signup_verify_code',
      arguments: {
        continuationToken: 'tok_x',
        otp: '123456',
        termsVersion: '2026-06-15',
        acceptTerms: false,
      },
    })

    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('terms')
    expect(agentVerifyEmail).not.toHaveBeenCalled()
  })

  it('stops with the portal link when the API reports no terms version', async () => {
    const agentSignup = vi.fn().mockResolvedValue({
      signupPid: 'sgn_x',
      continuationToken: 'tok_x',
      step: 'verify_email',
      otpSentTo: 'p•••@acme.test',
    })
    const client = await connect(stubApi({ agentSignup }), true)

    const result = await client.callTool({
      name: 'air_signup_send_code',
      arguments: { name: 'A Person', email: 'person@acme.test', orgName: 'Acme' },
    })

    // Failing loud beats pinning a terms version inside a published package.
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain(MCP_AIR_PORTAL_SIGNUP_URL)
  })
})

/** A client that supports elicitation but not MCP Apps — Claude Code's shape. */
const connectWithElicitation = async (
  api: IntegratorApiClient,
  answers: ReadonlyArray<{ action: string; content?: Record<string, unknown> }>,
) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createAirMcpServer(
    { apiUrl: 'http://localhost:4001', apiKey: 'test-key' },
    { api },
  )
  const client = new Client(
    { name: 'elicitation-test', version: '1.0.0' },
    { capabilities: { elicitation: {} } },
  )
  const asked: unknown[] = []
  let turn = 0
  client.setRequestHandler(ElicitRequestSchema, (request) => {
    asked.push(request.params)
    const answer = answers[turn++] ?? { action: 'cancel' }
    return answer as never
  })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return { client, asked }
}

const signupStarted = {
  signupPid: 'sgn_x',
  continuationToken: 'tok_x',
  step: 'verify_email',
  otpSentTo: 'p•••@acme.test',
  termsVersion: '2026-06-15',
  termsUrl: 'https://air.thalus.ai/legal/terms',
  privacyUrl: 'https://air.thalus.ai/legal/privacy',
  otpLength: 6,
}

const accountCreated = {
  status: 'ready',
  orgSlug: 'acme',
  domainPid: 'dom_x',
  domainSlug: 'acme',
  credits: 1,
  signInUrl: 'https://air.thalus.ai/auth/one-time/abc',
}

describe('air_create_account without MCP Apps', () => {
  it('creates the account through two dialogs', async () => {
    const agentSignup = vi.fn().mockResolvedValue(signupStarted)
    const agentVerifyEmail = vi.fn().mockResolvedValue(accountCreated)
    const { client, asked } = await connectWithElicitation(
      stubApi({ agentSignup, agentVerifyEmail }),
      [
        { action: 'accept', content: { name: 'A Person', email: 'p@acme.test', orgName: 'Acme' } },
        { action: 'accept', content: { otp: '123456', acceptTerms: true } },
      ],
    )

    const result = resultJson(await client.callTool({ name: 'air_create_account', arguments: {} }))

    expect(agentSignup).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'A Person', email: 'p@acme.test', orgName: 'Acme' }),
    )
    expect(agentVerifyEmail).toHaveBeenCalledWith({
      continuationToken: 'tok_x',
      otp: '123456',
      termsVersion: '2026-06-15',
      acceptTerms: true,
    })
    expect(result.orgSlug).toBe('acme')
    expect(asked).toHaveLength(2)
  })

  it('puts the terms and privacy links from the server in the checkbox label', async () => {
    const { client, asked } = await connectWithElicitation(
      stubApi({ agentSignup: vi.fn().mockResolvedValue(signupStarted) }),
      [
        { action: 'accept', content: { name: 'A Person', email: 'p@acme.test', orgName: 'Acme' } },
        { action: 'cancel' },
      ],
    )

    await client.callTool({ name: 'air_create_account', arguments: {} })

    const second = asked[1] as {
      requestedSchema: { properties: Record<string, { title: string }> }
    }
    expect(second.requestedSchema.properties['acceptTerms'].title).toContain(
      'https://air.thalus.ai/legal/terms',
    )
    expect(second.requestedSchema.properties['acceptTerms'].title).toContain(
      'https://air.thalus.ai/legal/privacy',
    )
    // The code length comes from the server, never assumed.
    expect(second.requestedSchema.properties['otp'].title).toBe('6-digit code')
  })

  it('refuses and creates nothing when the terms box is left unticked', async () => {
    const agentVerifyEmail = vi.fn()
    const { client } = await connectWithElicitation(
      stubApi({ agentSignup: vi.fn().mockResolvedValue(signupStarted), agentVerifyEmail }),
      [
        { action: 'accept', content: { name: 'A Person', email: 'p@acme.test', orgName: 'Acme' } },
        { action: 'accept', content: { otp: '123456', acceptTerms: false } },
      ],
    )

    const result = await client.callTool({ name: 'air_create_account', arguments: {} })

    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('terms were not accepted')
    expect(agentVerifyEmail).not.toHaveBeenCalled()
  })

  it('leaves nothing half-made when the first dialog is cancelled', async () => {
    const agentSignup = vi.fn()
    const { client } = await connectWithElicitation(stubApi({ agentSignup }), [
      { action: 'cancel' },
    ])

    const result = await client.callTool({ name: 'air_create_account', arguments: {} })

    expect(agentSignup).not.toHaveBeenCalled()
    expect(resultText(result)).toContain('No account was created')
  })

  it('says what happened when the second dialog is cancelled after the code was sent', async () => {
    const agentVerifyEmail = vi.fn()
    const { client } = await connectWithElicitation(
      stubApi({ agentSignup: vi.fn().mockResolvedValue(signupStarted), agentVerifyEmail }),
      [
        { action: 'accept', content: { name: 'A Person', email: 'p@acme.test', orgName: 'Acme' } },
        { action: 'decline' },
      ],
    )

    const result = await client.callTool({ name: 'air_create_account', arguments: {} })

    expect(agentVerifyEmail).not.toHaveBeenCalled()
    const text = resultText(result)
    expect(text).toContain('No account was created')
    // The person has a code in their inbox; say it leads nowhere now.
    expect(text).toContain('unused')
  })

  it('never asks for a secret in a dialog', async () => {
    const { client, asked } = await connectWithElicitation(
      stubApi({ agentSignup: vi.fn().mockResolvedValue(signupStarted) }),
      [
        { action: 'accept', content: { name: 'A Person', email: 'p@acme.test', orgName: 'Acme' } },
        { action: 'cancel' },
      ],
    )

    await client.callTool({ name: 'air_create_account', arguments: {} })

    const fields = asked.flatMap((params) =>
      Object.keys(
        (params as { requestedSchema: { properties: Record<string, unknown> } }).requestedSchema
          .properties,
      ),
    )
    expect(fields.sort()).toEqual(['acceptTerms', 'email', 'name', 'orgName', 'otp'])
  })
})

describe('sign-in URL handling', () => {
  it('keeps the sign-in URL out of a model-visible result on the elicitation path', async () => {
    const agentVerifyEmail = vi.fn().mockResolvedValue(accountCreated)
    const { client } = await connectWithElicitation(
      stubApi({ agentSignup: vi.fn().mockResolvedValue(signupStarted), agentVerifyEmail }),
      [
        { action: 'accept', content: { name: 'A Person', email: 'p@acme.test', orgName: 'Acme' } },
        { action: 'accept', content: { otp: '123456', acceptTerms: true } },
      ],
    )

    const result = await client.callTool({ name: 'air_create_account', arguments: {} })

    // The sign-in URL is a bearer credential: it grants a browser session for
    // the new account. There is no iframe on this path, so it must not reach
    // the transcript. The account is usable regardless — the key is on disk.
    expect(JSON.stringify(result)).not.toContain(accountCreated.signInUrl)
    expect(resultJson(result).orgSlug).toBe('acme')
  })

  it('still gives the form its sign-in URL, which never leaves the iframe', async () => {
    const agentVerifyEmail = vi.fn().mockResolvedValue(accountCreated)
    const client = await connect(stubApi({ agentVerifyEmail }), true)

    const done = resultJson(
      await client.callTool({
        name: 'air_signup_verify_code',
        arguments: {
          continuationToken: 'tok_x',
          otp: '123456',
          termsVersion: '2026-06-15',
          acceptTerms: true,
        },
      }),
    )

    expect(done.signInUrl).toBe(accountCreated.signInUrl)
  })
})
