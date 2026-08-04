import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it } from 'vitest'

import { MCP_AIR_TASK_REQUIRED_TOOL_NAMES } from '../src/capabilities.js'
import { IntegratorApiClient } from '../src/client/integrator-api.js'
import { createAirMcpServer } from '../src/server.js'

const connectTaskClient = async (api: IntegratorApiClient) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createAirMcpServer(
    { apiUrl: 'http://localhost:4001', apiKey: 'test-key' },
    { api },
  )
  const client = new Client(
    { name: 'mcp-air-task-test-client', version: '1.0.0' },
    {
      capabilities: {
        tasks: {
          requests: {
            tools: { call: {} },
          },
        },
      },
    },
  )

  await server.connect(serverTransport)
  await client.connect(clientTransport)

  return { client, server }
}

const connectPlainClient = async (api: IntegratorApiClient) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createAirMcpServer(
    { apiUrl: 'http://localhost:4001', apiKey: 'test-key' },
    { api },
  )
  const client = new Client({ name: 'mcp-air-plain-test-client', version: '1.0.0' })

  await server.connect(serverTransport)
  await client.connect(clientTransport)

  return { client, server }
}

describe('MCP Tasks for long-running composite tools', () => {
  it('advertises taskSupport required only on pipeline tools', async () => {
    const { client } = await connectTaskClient(
      new IntegratorApiClient('http://localhost:4001', 'k'),
    )
    const tools = await client.listTools()

    for (const name of MCP_AIR_TASK_REQUIRED_TOOL_NAMES) {
      const tool = tools.tools.find((row) => row.name === name)
      expect(tool?.execution?.taskSupport).toBe('required')
    }

    for (const name of ['air_wait_for_document_extraction', 'air_wait_for_assessment'] as const) {
      const tool = tools.tools.find((row) => row.name === name)
      expect(tool?.execution?.taskSupport).not.toBe('required')
    }
  })

  it('blocks on wait tools without task augmentation', async () => {
    const api = new IntegratorApiClient('http://localhost:4001', 'k')
    api.listDocuments = async () => [{ pid: 'psrc_test', status: 'connected' }]

    const { client } = await connectPlainClient(api)
    const result = await client.callTool({
      name: 'air_wait_for_document_extraction',
      arguments: { projectPid: 'proj_test', sourcePid: 'psrc_test', timeoutMs: 5_000 },
    })

    expect(result.isError).not.toBe(true)
    const textBlock = Array.isArray(result.content)
      ? result.content.find((row) => row.type === 'text')
      : undefined
    expect(textBlock?.type === 'text' ? textBlock.text : '').toContain('psrc_test')
    expect(textBlock?.type === 'text' ? textBlock.text : '').toContain('connected')
  })

  it('returns a task handle immediately for pipeline tools and completes via tasks/get', async () => {
    const api = new IntegratorApiClient('http://localhost:4001', 'k')
    api.startAssessment = async () => ({
      assessmentPid: 'pasm_test',
      workflowRunId: 'wf_test',
    })
    api.getAssessment = async () => ({
      pid: 'pasm_test',
      status: 'completed',
      reportAvailable: true,
    })
    api.getAssessmentReport = async () => ({
      overview: { totalRisks: 0 },
      projectName: 'Demo',
      euAiActTier: { available: false },
    })

    const { client } = await connectTaskClient(api)
    const stream = client.experimental.tasks.callToolStream(
      {
        name: 'air_run_full_assessment_pipeline',
        arguments: {
          projectPid: 'proj_test',
          artifactPids: ['artf_test'],
          name: 'Test run',
          waitTimeoutMs: 5_000,
        },
      },
      CallToolResultSchema,
      { task: { ttl: 60_000 } },
    )

    let sawTaskCreated = false
    let finalText: string | undefined

    for await (const message of stream) {
      if (message.type === 'taskCreated') {
        sawTaskCreated = true
        expect(message.task.status).toBe('working')
        expect(message.task.taskId.length).toBeGreaterThan(0)
      }
      if (message.type === 'result') {
        const textBlock = message.result.content.find((row) => row.type === 'text')
        finalText = textBlock?.type === 'text' ? textBlock.text : undefined
      }
    }

    expect(sawTaskCreated).toBe(true)
    expect(finalText).toContain('pasm_test')
  }, 15_000)

  it('rejects synchronous callTool on task-required pipeline tools', async () => {
    const { client } = await connectTaskClient(
      new IntegratorApiClient('http://localhost:4001', 'k'),
    )
    await client.listTools()

    await expect(
      client.callTool({
        name: 'air_run_full_assessment_pipeline',
        arguments: {
          projectPid: 'proj_test',
          artifactPids: ['artf_test'],
          name: 'Test',
        },
      }),
    ).rejects.toThrow(/requires task-based execution/)
  })
})
