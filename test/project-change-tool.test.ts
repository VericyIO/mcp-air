import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it, vi } from 'vitest'

import type { IntegratorApiClient } from '../src/client/integrator-api.js'
import { createAirMcpServer } from '../src/server.js'

const stubApi = () => ({
  resolveApiKey: () => 'air_key',
  createProject: vi.fn().mockResolvedValue({ pid: 'prj_new', webUrl: 'https://air.test/p/new' }),
  updateProject: vi.fn().mockResolvedValue({ pid: 'prj_1', webUrl: 'https://air.test/p/1' }),
  renameDomain: vi.fn().mockResolvedValue({ pid: 'dom_1', name: 'Core' }),
})

const connect = async (api: ReturnType<typeof stubApi>) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createAirMcpServer(
    { apiUrl: 'http://localhost:4001', apiKey: 'air_key' },
    { api: api as unknown as IntegratorApiClient },
  )
  const client = new Client({ name: 'project-change-test', version: '1.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return client
}

const call = async (args: Record<string, unknown>) => {
  const api = stubApi()
  const client = await connect(api)
  const result = await client.callTool({ name: 'air_create_project', arguments: args })
  const text = (result.content as ReadonlyArray<{ text?: string }>)[0]?.text ?? ''
  return { api, result, text }
}

describe('air_create_project', () => {
  it('creates a project from name and slug', async () => {
    const { api, text } = await call({ domainPid: 'dom_1', name: 'Neuron', slug: 'neuron' })

    expect(api.createProject).toHaveBeenCalledWith('dom_1', { name: 'Neuron', slug: 'neuron' })
    expect(api.updateProject).not.toHaveBeenCalled()
    expect(api.renameDomain).not.toHaveBeenCalled()
    expect(JSON.parse(text)).toEqual({ pid: 'prj_new', webUrl: 'https://air.test/p/new' })
  })

  it('edits only the fields given when projectPid is passed', async () => {
    const { api } = await call({ domainPid: 'dom_1', projectPid: 'prj_1', description: 'For Regeneron' })

    expect(api.updateProject).toHaveBeenCalledWith('dom_1', 'prj_1', { description: 'For Regeneron' })
    expect(api.createProject).not.toHaveBeenCalled()
  })

  it('clears the description when an edit passes an empty string', async () => {
    const { api } = await call({ domainPid: 'dom_1', projectPid: 'prj_1', description: '' })

    expect(api.updateProject).toHaveBeenCalledWith('dom_1', 'prj_1', { description: null })
  })

  it('renames the domain alone', async () => {
    const { api, text } = await call({ domainPid: 'dom_1', domainName: 'Core' })

    expect(api.renameDomain).toHaveBeenCalledWith('dom_1', 'Core')
    expect(api.createProject).not.toHaveBeenCalled()
    expect(api.updateProject).not.toHaveBeenCalled()
    expect(JSON.parse(text)).toEqual({ pid: 'dom_1', name: 'Core' })
  })

  it('renames the domain and edits the project in one call', async () => {
    const { api, text } = await call({
      domainPid: 'dom_1',
      projectPid: 'prj_1',
      name: 'Neuron',
      domainName: 'Core',
    })

    expect(api.renameDomain).toHaveBeenCalledWith('dom_1', 'Core')
    expect(api.updateProject).toHaveBeenCalledWith('dom_1', 'prj_1', { name: 'Neuron' })
    expect(JSON.parse(text)).toEqual({
      pid: 'prj_1',
      webUrl: 'https://air.test/p/1',
      domain: { pid: 'dom_1', name: 'Core' },
    })
  })

  it.each([
    ['a slug change on an edit', { projectPid: 'prj_1', slug: 'new-slug', domainName: 'Core' }, 'slug cannot change'],
    ['an edit with nothing to change', { projectPid: 'prj_1', domainName: 'Core' }, 'new name or description'],
    ['a create without a slug', { name: 'Neuron', domainName: 'Core' }, 'both name and slug'],
    ['no change at all', {}, 'Nothing to change'],
  ])('refuses %s before any API call', async (_label, args, message) => {
    const { api, result, text } = await call({ domainPid: 'dom_1', ...args })

    expect(result.isError).toBe(true)
    expect(text).toContain(message)
    expect(api.renameDomain).not.toHaveBeenCalled()
    expect(api.createProject).not.toHaveBeenCalled()
    expect(api.updateProject).not.toHaveBeenCalled()
  })
})
