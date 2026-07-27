import { describe, expect, it, vi } from 'vitest'

import { IntegratorApiClient } from '../src/client/integrator-api.js'
import { loadMcpAirConfig } from '../src/config.js'
import { formatIntegratorApiError } from '../src/errors.js'

describe('loadMcpAirConfig', () => {
  it('requires AIR_API_KEY', () => {
    expect(() => loadMcpAirConfig({})).toThrow(/AIR_API_KEY/)
  })

  it('defaults API URL to production origin', () => {
    const config = loadMcpAirConfig({ AIR_API_KEY: 'test-key' })
    expect(config.apiUrl).toBe('https://api.air.thalus.ai')
    expect(config.apiKey).toBe('test-key')
  })

  it('strips trailing slash from AIR_API_URL', () => {
    const config = loadMcpAirConfig({
      AIR_API_KEY: 'k',
      AIR_API_URL: 'http://localhost:4001/',
    })
    expect(config.apiUrl).toBe('http://localhost:4001')
  })
})

describe('formatIntegratorApiError', () => {
  it('maps 401 to actionable message', () => {
    expect(formatIntegratorApiError(401, '')).toMatch(/authentication failed/)
  })

  it('maps 403 to scope hint', () => {
    expect(formatIntegratorApiError(403, 'missing scope')).toMatch(/forbidden/)
  })
})

describe('IntegratorApiClient', () => {
  it('healthCheck sends bearer token', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ name: 'AIR API', status: 'ok' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = new IntegratorApiClient('http://localhost:4001', 'secret-key')
    const info = await client.healthCheck()

    expect(info.status).toBe('ok')
    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer secret-key',
    })
  })

  it('throws IntegratorApiError on non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 403 })))

    const client = new IntegratorApiClient('http://localhost:4001', 'k')
    await expect(client.listDomains()).rejects.toMatchObject({ status: 403 })
  })
})
