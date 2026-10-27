import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { IntegratorApiClient } from '../src/client/integrator-api.js'
import type { IntegratorApiClient as IntegratorApiClientType } from '../src/client/integrator-api.js'
import { createAirMcpServer } from '../src/server.js'

const connect = async (api: IntegratorApiClientType) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createAirMcpServer(
    { apiUrl: 'http://localhost:4001', apiKey: 'test-key' },
    { api },
  )
  const client = new Client({ name: 'upload-document-test', version: '1.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return client
}

const resultText = (result: Awaited<ReturnType<Client['callTool']>>) =>
  (result.content as ReadonlyArray<{ text?: string }>).map((part) => part.text ?? '').join('')

describe.sequential('air_upload_document', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('puts the content, then completes the upload and waits', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response('', { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const real = new IntegratorApiClient('http://localhost:4001', 'test-key')
    const initUpload = vi.fn().mockResolvedValue({
      uploadUrl: 'https://storage.example/put',
      s3Key: 's3/key',
    })
    const completeUpload = vi.fn().mockResolvedValue({
      sourcePid: 'psrc_1',
      workflowPid: 'wf_1',
    })
    const listDocuments = vi.fn().mockResolvedValue([
      { pid: 'psrc_1', status: 'connected', filename: 'notes.md' },
    ])
    const api = {
      initUpload,
      completeUpload,
      listDocuments,
      uploadContentToPresignedUrl: (uploadUrl: string, content: string, contentType: string) =>
        real.uploadContentToPresignedUrl(uploadUrl, content, contentType),
    } as unknown as IntegratorApiClientType
    const client = await connect(api)

    const result = await client.callTool({
      name: 'air_upload_document',
      arguments: {
        projectPid: 'proj_1',
        fileName: 'notes.md',
        content: '# scan',
        contentType: 'text/plain',
      },
    })

    expect(result.isError).not.toBe(true)
    expect(initUpload).toHaveBeenCalledTimes(1)
    expect(initUpload).toHaveBeenCalledWith('proj_1', 'notes.md', 'text/plain')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://storage.example/put')
    expect(init?.method).toBe('PUT')
    expect(init?.body).toBe('# scan')
    expect(init?.headers).toEqual({ 'Content-Type': 'text/plain' })
    expect(completeUpload).toHaveBeenCalledTimes(1)
    expect(completeUpload).toHaveBeenCalledWith('proj_1', {
      s3Key: 's3/key',
      filename: 'notes.md',
      contentType: 'text/plain',
    })
    expect(listDocuments).toHaveBeenCalledTimes(1)
    expect(listDocuments).toHaveBeenCalledWith('proj_1')
    expect(initUpload.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0] ?? 0)
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(completeUpload.mock.invocationCallOrder[0] ?? 0)
    expect(completeUpload.mock.invocationCallOrder[0]).toBeLessThan(
      listDocuments.mock.invocationCallOrder[0] ?? 0,
    )
    expect(JSON.parse(resultText(result))).toEqual({
      sourcePid: 'psrc_1',
      status: 'connected',
      ready: true,
    })
  })

  it('sends text/markdown when contentType is omitted', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response('', { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const real = new IntegratorApiClient('http://localhost:4001', 'test-key')
    const initUpload = vi.fn().mockResolvedValue({
      uploadUrl: 'https://storage.example/markdown',
      s3Key: 's3/md',
    })
    const completeUpload = vi.fn().mockResolvedValue({ sourcePid: 'psrc_md', workflowPid: 'wf_md' })
    const listDocuments = vi.fn().mockResolvedValue([{ pid: 'psrc_md', status: 'connected' }])
    const api = {
      initUpload,
      completeUpload,
      listDocuments,
      uploadContentToPresignedUrl: (uploadUrl: string, content: string, contentType: string) =>
        real.uploadContentToPresignedUrl(uploadUrl, content, contentType),
    } as unknown as IntegratorApiClientType
    const client = await connect(api)

    await client.callTool({
      name: 'air_upload_document',
      arguments: { projectPid: 'proj_1', fileName: 'scan.md', content: '# md' },
    })

    expect(initUpload).toHaveBeenCalledWith('proj_1', 'scan.md', 'text/markdown')
    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(init?.headers).toEqual({ 'Content-Type': 'text/markdown' })
    expect(init?.body).toBe('# md')
  })

  it('returns a tool error naming the HTTP status when the PUT fails', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response('SignatureDoesNotMatch', { status: 403 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const real = new IntegratorApiClient('http://localhost:4001', 'test-key')
    const initUpload = vi.fn().mockResolvedValue({
      uploadUrl: 'https://storage.example/put',
      s3Key: 's3/key',
    })
    const completeUpload = vi.fn()
    const listDocuments = vi.fn()
    const api = {
      initUpload,
      completeUpload,
      listDocuments,
      uploadContentToPresignedUrl: (uploadUrl: string, content: string, contentType: string) =>
        real.uploadContentToPresignedUrl(uploadUrl, content, contentType),
    } as unknown as IntegratorApiClientType
    const client = await connect(api)

    const result = await client.callTool({
      name: 'air_upload_document',
      arguments: {
        projectPid: 'proj_1',
        fileName: 'notes.md',
        content: '# scan',
        contentType: 'text/plain',
      },
    })

    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('403')
    expect(initUpload).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(completeUpload).not.toHaveBeenCalled()
    expect(listDocuments).not.toHaveBeenCalled()
  })
})
