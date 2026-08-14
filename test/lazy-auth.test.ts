import type { AddressInfo } from 'node:net'

import { describe, expect, it } from 'vitest'

import { createMcpAirHttpApp } from '../src/http-server.js'
import type { McpAirHttpRuntimeConfig } from '../src/http-config.js'
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
