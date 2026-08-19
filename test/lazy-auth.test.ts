import type { AddressInfo } from 'node:net'

import { describe, expect, it } from 'vitest'

import { MCP_AIR_SIGNUP_FORM_URI } from '../src/config.js'
import { createMcpAirHttpApp } from '../src/http-server.js'
import {
  loadMcpAirHttpRuntimeConfig,
  MCP_AIR_OAUTH_RESOURCE_IDENTIFIER,
  type McpAirHttpRuntimeConfig,
} from '../src/http-config.js'
import { MCP_AIR_PUBLIC_TOOL_NAMES, requestNeedsAuthentication } from '../src/surface.js'

const testConfig: McpAirHttpRuntimeConfig = {
  apiUrl: 'http://127.0.0.1:4001',
  httpHost: '127.0.0.1',
  httpPort: 0,
  httpPath: '/mcp',
  mcpResourceIdentifier: 'https://mcp.air.thalus.ai/mcp',
}

const startTestServer = async () => {
  const { app, close } = await createMcpAirHttpApp(testConfig)
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${String(port)}/mcp`,
    stop: async () => {
      await close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  })

const initializeRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'lazy-auth-test', version: '1.0.0' },
  },
}

const toolCall = (name: string) => ({
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: { name, arguments: {} },
})

const resourceRead = (uri: string) => ({
  jsonrpc: '2.0',
  id: 3,
  method: 'resources/read',
  params: { uri },
})

/** Opens an anonymous session and returns its id, as a client with no token does. */
const anonymousSession = async (url: string) => {
  const response = await post(url, initializeRequest)
  const sessionId = response.headers.get('mcp-session-id')
  if (sessionId === null) {
    throw new Error('no session id returned for an anonymous initialize')
  }
  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  })

  return sessionId
}

const postInSession = (url: string, sessionId: string, body: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify(body),
  })

describe('requestNeedsAuthentication', () => {
  it('lets the handshake and discovery through without a token', () => {
    expect(requestNeedsAuthentication(initializeRequest)).toBe(false)
    expect(
      requestNeedsAuthentication({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
    ).toBe(false)
    expect(
      requestNeedsAuthentication({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    ).toBe(false)
  })

  it('lets the public tools through and protects everything else', () => {
    for (const name of MCP_AIR_PUBLIC_TOOL_NAMES) {
      expect(requestNeedsAuthentication(toolCall(name))).toBe(false)
    }
    expect(requestNeedsAuthentication(toolCall('air_list_domains'))).toBe(true)
    expect(requestNeedsAuthentication(toolCall('air_request_credits'))).toBe(true)
    expect(requestNeedsAuthentication(toolCall('air_get_credit_balance'))).toBe(true)
  })

  it('protects a batch when any message in it is protected', () => {
    expect(requestNeedsAuthentication([toolCall('air_submit_feedback')])).toBe(false)
    expect(
      requestNeedsAuthentication([toolCall('air_submit_feedback'), toolCall('air_list_domains')]),
    ).toBe(true)
  })

  it('lets the signup form be read but keeps every data resource protected', () => {
    // The form is the page that creates the account, so a caller with no token
    // must be able to fetch it. Nothing else opens.
    expect(requestNeedsAuthentication(resourceRead(MCP_AIR_SIGNUP_FORM_URI))).toBe(false)
    expect(requestNeedsAuthentication(resourceRead('air://assessments/asm_x/report'))).toBe(true)
    expect(requestNeedsAuthentication(resourceRead('air://projects/prj_x/assessments'))).toBe(true)
    expect(
      requestNeedsAuthentication({ jsonrpc: '2.0', id: 3, method: 'resources/read' }),
    ).toBe(true)
  })

  it('lets every client notification through', () => {
    // A notification expects no reply, and the 401 challenge is what makes a host
    // show its Connect card. `roots/list_changed` is mandatory for any client that
    // declares the capability, so this arrives whether or not anyone signed in.
    for (const method of [
      'notifications/initialized',
      'notifications/cancelled',
      'notifications/progress',
      'notifications/roots/list_changed',
    ]) {
      expect(requestNeedsAuthentication({ jsonrpc: '2.0', method })).toBe(false)
    }
    // A request wearing a notification's name is still a request.
    expect(
      requestNeedsAuthentication({ jsonrpc: '2.0', id: 1, method: 'notifications/roots/list' }),
    ).toBe(true)
  })

  it('lets a client answer a request this server sent it', () => {
    // Elicitation is a server-initiated request; the reply is a response frame.
    expect(
      requestNeedsAuthentication({ jsonrpc: '2.0', id: 0, result: { action: 'accept' } }),
    ).toBe(false)
    expect(
      requestNeedsAuthentication({ jsonrpc: '2.0', id: 0, error: { code: -1, message: 'no' } }),
    ).toBe(false)
    // Anything else without a method stays protected.
    expect(requestNeedsAuthentication({ jsonrpc: '2.0', id: 0 })).toBe(true)
    expect(requestNeedsAuthentication({ jsonrpc: '2.0', result: {} })).toBe(true)
    expect(requestNeedsAuthentication({ jsonrpc: '2.0', id: null, result: {} })).toBe(true)
  })

  it('treats an unknown method or a nameless tool call as protected', () => {
    expect(
      requestNeedsAuthentication({
        jsonrpc: '2.0',
        id: 1,
        method: 'completion/complete',
      }),
    ).toBe(true)
    expect(
      requestNeedsAuthentication({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
      }),
    ).toBe(true)
  })
})

describe('deployment identity in the OAuth challenge', () => {
  it('points resource metadata at the API this deployment talks to', async () => {
    // Pinned to production, a dev deployment sends half its OAuth discovery to
    // production and no flow against another environment can complete.
    const server = await startTestServer()
    try {
      const response = await post(server.url, toolCall('air_list_domains'))
      const challenge = response.headers.get('www-authenticate') ?? ''

      expect(challenge).toContain(
        `resource_metadata="${testConfig.apiUrl}/.well-known/oauth-protected-resource"`,
      )
    } finally {
      await server.stop()
    }
  })

  it('takes the audience from the environment, defaulting to production', () => {
    expect(
      loadMcpAirHttpRuntimeConfig({ MCP_OAUTH_RESOURCE: 'https://mcp-dev.air.thalus.ai/mcp/' })
        .mcpResourceIdentifier,
    ).toBe('https://mcp-dev.air.thalus.ai/mcp')
    expect(loadMcpAirHttpRuntimeConfig({}).mcpResourceIdentifier).toBe(
      MCP_AIR_OAUTH_RESOURCE_IDENTIFIER,
    )
  })
})

describe('hosted transport lazy authentication', () => {
  it('accepts initialize with no token', async () => {
    const server = await startTestServer()
    try {
      const response = await post(server.url, initializeRequest)

      expect(response.status).toBe(200)
      expect(response.headers.get('mcp-session-id')).toBeTruthy()
    } finally {
      await server.stop()
    }
  })

  it('answers a protected tool call with a 401 carrying WWW-Authenticate', async () => {
    const server = await startTestServer()
    try {
      const response = await post(server.url, toolCall('air_list_domains'))

      // A 200 with isError would show the user text instead of a Connect card.
      expect(response.status).toBe(401)
      const challenge = response.headers.get('www-authenticate') ?? ''
      expect(challenge).toContain('Bearer')
      expect(challenge).toContain('resource_metadata=')
      expect(challenge).toContain('scope="fullPipeline"')
    } finally {
      await server.stop()
    }
  })

  it('serves the signup form to a caller who has no account yet', async () => {
    const server = await startTestServer()
    try {
      const sessionId = await anonymousSession(server.url)
      const response = await postInSession(
        server.url,
        sessionId,
        resourceRead(MCP_AIR_SIGNUP_FORM_URI),
      )

      expect(response.status).toBe(200)
      // The tool result carries only the address, so a 200 here is what decides
      // whether the form can render at all.
      expect(await response.text()).toContain('Create your AIR account')
    } finally {
      await server.stop()
    }
  })

  it('still answers 401 for a data resource without a token', async () => {
    const server = await startTestServer()
    try {
      const sessionId = await anonymousSession(server.url)
      const response = await postInSession(
        server.url,
        sessionId,
        resourceRead('air://assessments/asm_x/report'),
      )

      expect(response.status).toBe(401)
      expect(response.headers.get('www-authenticate') ?? '').toContain('Bearer')
    } finally {
      await server.stop()
    }
  })

  it('accepts an elicitation answer from a session with no token', async () => {
    const server = await startTestServer()
    try {
      const sessionId = await anonymousSession(server.url)
      const response = await postInSession(server.url, sessionId, {
        jsonrpc: '2.0',
        id: 0,
        result: { action: 'accept', content: { name: 'A', email: 'a@b.co', orgName: 'C' } },
      })

      // The person types their details into the dialog; rejecting the reply
      // would strand them mid-signup.
      expect(response.status).not.toBe(401)
    } finally {
      await server.stop()
    }
  })

  it('does not challenge a roots change on an unauthenticated session', async () => {
    const server = await startTestServer()
    try {
      const sessionId = await anonymousSession(server.url)
      const response = await postInSession(server.url, sessionId, {
        jsonrpc: '2.0',
        method: 'notifications/roots/list_changed',
      })

      expect(response.status).not.toBe(401)
    } finally {
      await server.stop()
    }
  })

  it('marks the token invalid only when one was actually presented', async () => {
    const server = await startTestServer()
    try {
      const withoutToken = await post(server.url, toolCall('air_list_domains'))
      expect(withoutToken.headers.get('www-authenticate')).not.toContain('error="invalid_token"')
    } finally {
      await server.stop()
    }
  })
})
