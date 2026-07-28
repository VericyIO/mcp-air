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
import { createAirMcpServer } from '../src/server.js'
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

const resourceText = (contents: ReadonlyArray<{ text?: string; blob?: string }>, index = 0) => {
  const content = contents[index]
  if (content?.text !== undefined) {
    return content.text
  }
  throw new Error('Expected text resource contents in test')
}

describe('createAirMcpServer', () => {
  it('omits local-file tool on remote surface', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const remoteServer = createAirMcpServer(
      { apiUrl: 'http://localhost:4001', apiKey: 'test-key' },
      { surface: 'remote' },
    )
    const remoteClient = new Client({ name: 'mcp-air-remote-test', version: '1.1.0' })
    await remoteServer.connect(serverTransport)
    await remoteClient.connect(clientTransport)

    const tools = await remoteClient.listTools()
    expect(tools.tools.map((tool) => tool.name)).not.toContain('air_run_assessment_from_file')
    expect(tools.tools).toHaveLength(24)
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
