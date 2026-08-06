import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it, vi } from 'vitest'

import {
  MCP_AIR_EXPECTED_PROMPT_COUNT,
  MCP_AIR_EXPECTED_PROMPT_NAMES,
  MCP_AIR_EXPECTED_RESOURCE_TEMPLATE_COUNT,
  MCP_AIR_EXPECTED_RESOURCE_TEMPLATE_NAMES,
  MCP_AIR_EXPECTED_RESOURCE_TEMPLATE_URI_PATTERNS,
  MCP_AIR_EXPECTED_TOOL_COUNT,
  MCP_AIR_EXPECTED_TOOL_NAMES,
  MCP_AIR_TASK_REQUIRED_TOOL_NAMES,
} from '../src/capabilities.js'
import type { IntegratorApiClient } from '../src/client/integrator-api.js'
import {
  MCP_AIR_MAX_TOOL_RESULT_CHARS,
  MCP_AIR_REMOTE_WAIT_TIMEOUT_MS,
} from '../src/config.js'
import { createAirMcpServer } from '../src/server.js'
import { MCP_AIR_REMOTE_TOOL_COUNT, MCP_AIR_REMOTE_TOOL_NAMES } from '../src/surface.js'
import { MCP_AIR_TOOL_TITLES } from '../src/tool-titles.js'

const connectTestClient = (api?: IntegratorApiClient) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createAirMcpServer(
    {
      apiUrl: 'http://localhost:4001',
      apiKey: 'test-key',
    },
    api === undefined ? {} : { api },
  )
  const client = new Client({ name: 'mcp-air-test-client', version: '1.0.0' })

  return { client, server, clientTransport, serverTransport }
}

const connect = async (api?: IntegratorApiClient) => {
  const { client, server, clientTransport, serverTransport } = connectTestClient(api)
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return { client, server }
}

const connectRemote = async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const remoteServer = createAirMcpServer(
    { apiUrl: 'http://localhost:4001', apiKey: 'test-key' },
    { surface: 'remote' },
  )
  const remoteClient = new Client({ name: 'mcp-air-remote-test', version: '1.1.0' })
  await remoteServer.connect(serverTransport)
  await remoteClient.connect(clientTransport)
  return remoteClient.listTools()
}

const resourceText = (contents: ReadonlyArray<{ text?: string; blob?: string }>, index = 0) => {
  const content = contents[index]
  if (content?.text !== undefined) {
    return content.text
  }
  throw new Error('Expected text resource contents in test')
}

describe('createAirMcpServer', () => {
  it('exposes exactly the hosted-client tool surface on remote', async () => {
    const tools = await connectRemote()

    expect(tools.tools).toHaveLength(MCP_AIR_REMOTE_TOOL_COUNT)
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      [...MCP_AIR_REMOTE_TOOL_NAMES].sort(),
    )
  })

  it('omits tools hosted Claude clients cannot drive', async () => {
    const tools = await connectRemote()
    const names = tools.tools.map((tool) => tool.name)

    // No local filesystem, and no draft Tasks extension.
    expect(names).not.toContain('air_run_assessment_from_file')
    expect(names).not.toContain('air_run_full_assessment_pipeline')

    // The presigned upload pair stays: hosted clients can PUT to the storage host.
    expect(names).toContain('air_upload_document_init')
    expect(names).toContain('air_upload_document_complete')

    for (const tool of tools.tools) {
      expect(tool.execution?.taskSupport).not.toBe('required')
    }
  })

  it('caps remote wait tools under the hosted tool-call timeout', async () => {
    const tools = await connectRemote()

    for (const name of ['air_wait_for_document_extraction', 'air_wait_for_assessment'] as const) {
      const tool = tools.tools.find((row) => row.name === name)
      const timeoutMs = (
        tool?.inputSchema as { properties?: { timeoutMs?: { maximum?: number } } } | undefined
      )?.properties?.timeoutMs
      expect(timeoutMs?.maximum).toBe(MCP_AIR_REMOTE_WAIT_TIMEOUT_MS)
    }
  })

  it('annotates every remote tool with a title and a read or write hint', async () => {
    const tools = await connectRemote()

    for (const tool of tools.tools) {
      expect(tool.title).toBe(
        MCP_AIR_TOOL_TITLES[tool.name as keyof typeof MCP_AIR_TOOL_TITLES],
      )
      expect(tool.name.length).toBeLessThanOrEqual(64)
      expect(tool.annotations?.readOnlyHint === true).toBe(
        tool.annotations?.destructiveHint !== true,
      )
    }
  })

  it('registers the expected MCP surface via protocol handshake', async () => {
    const { client } = await connect()

    const tools = await client.listTools()
    const resources = await client.listResources()
    const resourceTemplates = await client.listResourceTemplates()
    const prompts = await client.listPrompts()

    expect(tools.tools).toHaveLength(MCP_AIR_EXPECTED_TOOL_COUNT)
    expect(resources.resources).toHaveLength(0)
    expect(resourceTemplates.resourceTemplates).toHaveLength(
      MCP_AIR_EXPECTED_RESOURCE_TEMPLATE_COUNT,
    )
    expect(prompts.prompts).toHaveLength(MCP_AIR_EXPECTED_PROMPT_COUNT)

    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      [...MCP_AIR_EXPECTED_TOOL_NAMES].sort(),
    )
    expect(prompts.prompts.map((prompt) => prompt.name).sort()).toEqual(
      [...MCP_AIR_EXPECTED_PROMPT_NAMES].sort(),
    )
    expect(resourceTemplates.resourceTemplates.map((template) => template.name).sort()).toEqual(
      [...MCP_AIR_EXPECTED_RESOURCE_TEMPLATE_NAMES].sort(),
    )
    expect(
      resourceTemplates.resourceTemplates.map((template) => template.uriTemplate).sort(),
    ).toEqual([...MCP_AIR_EXPECTED_RESOURCE_TEMPLATE_URI_PATTERNS].sort())

    for (const name of MCP_AIR_TASK_REQUIRED_TOOL_NAMES) {
      const tool = tools.tools.find((row) => row.name === name)
      expect(tool?.execution?.taskSupport).toBe('required')
    }

    for (const name of MCP_AIR_EXPECTED_TOOL_NAMES) {
      const tool = tools.tools.find((row) => row.name === name)
      expect(tool?.title).toBe(MCP_AIR_TOOL_TITLES[name])
    }
  })

  it('reads parameterized resource URIs via resource templates', async () => {
    const assessmentPid = 'pasm_test123'
    const projectPid = 'prj_test456'
    const report = { projectName: 'Demo', overview: { totalRisks: 1 } }
    const stages = [{ stage: 'enrichment', status: 'completed' }]
    const assessments = [{ pid: assessmentPid, status: 'completed' }]

    const api = {
      getAssessmentReport: vi.fn().mockResolvedValue(report),
      listAssessmentStages: vi.fn().mockResolvedValue(stages),
      listAssessments: vi.fn().mockResolvedValue(assessments),
    } as unknown as IntegratorApiClient

    const { client } = await connect(api)

    const reportResource = await client.readResource({
      uri: `air://assessments/${assessmentPid}/report`,
    })
    expect(JSON.parse(resourceText(reportResource.contents))).toEqual(report)
    expect(api.getAssessmentReport).toHaveBeenCalledWith(assessmentPid)

    const stagesResource = await client.readResource({
      uri: `air://assessments/${assessmentPid}/stages`,
    })
    expect(JSON.parse(resourceText(stagesResource.contents))).toEqual(stages)
    expect(api.listAssessmentStages).toHaveBeenCalledWith(assessmentPid)

    const projectResource = await client.readResource({
      uri: `air://projects/${projectPid}/assessments`,
    })
    expect(JSON.parse(resourceText(projectResource.contents))).toEqual(assessments)
    expect(api.listAssessments).toHaveBeenCalledWith(projectPid)
  })
})

describe('air_get_assessment_report size handling', () => {
  const bigReport = () => ({
    assessmentPid: 'pasm_big',
    projectName: 'Demo',
    overview: { totalRisks: 400 },
    riskRegister: Array.from({ length: 400 }, (_, index) => ({
      id: `risk_${index}`,
      title: `Risk ${index}`,
      detail: 'x'.repeat(600),
    })),
  })

  const callReport = async (args: Record<string, unknown>) => {
    const api = {
      getAssessmentReport: vi.fn().mockResolvedValue(bigReport()),
    } as unknown as IntegratorApiClient
    const { client } = await connect(api)
    const result = await client.callTool({ name: 'air_get_assessment_report', arguments: args })
    const block = Array.isArray(result.content)
      ? result.content.find((row) => row.type === 'text')
      : undefined
    return {
      isError: result.isError === true,
      text: block?.type === 'text' ? block.text : '',
    }
  }

  it('returns a section index instead of a truncated report', async () => {
    const { isError, text } = await callReport({ assessmentPid: 'pasm_big' })
    const payload = JSON.parse(text)

    expect(isError).toBe(false)
    expect(text.length).toBeLessThanOrEqual(MCP_AIR_MAX_TOOL_RESULT_CHARS)
    expect(payload.complete).toBe(false)
    expect(payload.summary.riskRegisterCount).toBe(400)
    expect(payload.sections.find((row: { section: string }) => row.section === 'riskRegister')).toMatchObject(
      { present: true, itemCount: 400 },
    )
  })

  it('pages a list section and reports where to resume', async () => {
    const first = JSON.parse((await callReport({ assessmentPid: 'pasm_big', section: 'riskRegister' })).text)

    expect(first.totalItems).toBe(400)
    expect(first.offset).toBe(0)
    expect(first.complete).toBe(false)
    expect(first.nextOffset).toBe(first.returned)
    expect(first.riskRegister).toHaveLength(first.returned)

    const second = JSON.parse(
      (await callReport({ assessmentPid: 'pasm_big', section: 'riskRegister', offset: first.nextOffset })).text,
    )
    expect(second.offset).toBe(first.nextOffset)
    expect(second.riskRegister[0].id).toBe(`risk_${first.nextOffset}`)
  })

  it('honours an explicit limit', async () => {
    const { text } = await callReport({
      assessmentPid: 'pasm_big',
      section: 'riskRegister',
      offset: 10,
      limit: 3,
    })
    const payload = JSON.parse(text)

    expect(payload.returned).toBe(3)
    expect(payload.riskRegister.map((row: { id: string }) => row.id)).toEqual([
      'risk_10',
      'risk_11',
      'risk_12',
    ])
  })
})
