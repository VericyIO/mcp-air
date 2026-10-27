import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it, vi } from 'vitest'

import type { IntegratorApiClient } from '../src/client/integrator-api.js'
import { createAirMcpServer } from '../src/server.js'

describe('air_get_assessment_summary', () => {
  it('returns the tier, the matched criteria names, and the first five risks', async () => {
    const risks = Array.from({ length: 6 }, (_, index) => ({
      riskId: `risk_${index}`,
      riskTitle: `Title ${index}`,
      severity: index === 0 ? 'high' : 'low',
      likelihood: index === 0 ? null : 'medium',
      riskStatement: `Why ${index}`,
      signalHighlights: [{ signalText: 'not in the summary' }],
      themeName: 'Theme',
    }))
    const getAssessmentReport = vi.fn().mockResolvedValue({
      assessmentPid: 'pasm_sum',
      projectName: 'Demo',
      projectOverview: 'A scorer',
      overview: { totalRisks: 6 },
      quality: { score: 1 },
      systemProfile: { name: 'scorer' },
      projectDecisions: [],
      changesSincePrevious: null,
      euAiActTier: {
        available: true,
        tier: {
          value: 'HIGH',
          displayName: 'High',
          description: 'High risk',
          final: false,
        },
        criteria: [
          { name: 'Not this', criteriaStatus: 'not_triggered' },
          { name: 'Biometrics', criteriaStatus: 'triggered' },
          { name: 'Maybe', criteriaStatus: 'cannot_evaluate' },
          { name: 'Employment', criteriaStatus: 'triggered' },
        ],
        rawAssessment: { unacceptableRiskResults: { huge: true } },
        tierRationale: { text: 'long rationale', articlePageUrl: 'https://example', methodVersion: 'v1' },
      },
      riskRegister: risks,
    })
    const api = { getAssessmentReport } as unknown as IntegratorApiClient
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = createAirMcpServer(
      { apiUrl: 'http://localhost:4001', apiKey: 'test-key' },
      { api },
    )
    const client = new Client({ name: 'summary-test', version: '1.0.0' })
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const result = await client.callTool({
      name: 'air_get_assessment_summary',
      arguments: { assessmentPid: 'pasm_sum' },
    })
    const text = (result.content as ReadonlyArray<{ text?: string }>).map((part) => part.text ?? '').join('')
    const summary = JSON.parse(text) as Record<string, unknown>

    expect(getAssessmentReport).toHaveBeenCalledTimes(1)
    expect(getAssessmentReport).toHaveBeenCalledWith('pasm_sum')
    expect(summary).toEqual({
      assessmentPid: 'pasm_sum',
      projectName: 'Demo',
      projectOverview: 'A scorer',
      overview: { totalRisks: 6 },
      quality: { score: 1 },
      euAiActTier: {
        available: true,
        tier: {
          value: 'HIGH',
          displayName: 'High',
          description: 'High risk',
          final: false,
        },
        matchedCriteria: ['Biometrics', 'Employment'],
      },
      systemProfile: { name: 'scorer' },
      riskRegisterCount: 6,
      topRisks: [
        {
          riskId: 'risk_0',
          riskTitle: 'Title 0',
          severity: 'high',
          likelihood: null,
          riskStatement: 'Why 0',
        },
        {
          riskId: 'risk_1',
          riskTitle: 'Title 1',
          severity: 'low',
          likelihood: 'medium',
          riskStatement: 'Why 1',
        },
        {
          riskId: 'risk_2',
          riskTitle: 'Title 2',
          severity: 'low',
          likelihood: 'medium',
          riskStatement: 'Why 2',
        },
        {
          riskId: 'risk_3',
          riskTitle: 'Title 3',
          severity: 'low',
          likelihood: 'medium',
          riskStatement: 'Why 3',
        },
        {
          riskId: 'risk_4',
          riskTitle: 'Title 4',
          severity: 'low',
          likelihood: 'medium',
          riskStatement: 'Why 4',
        },
      ],
      watchlistCount: 0,
      clearedThemesCount: 0,
      cannotEvaluateThemesCount: 0,
      evidenceAppendixCount: 0,
      inputArtifactCount: 0,
      projectDecisions: [],
      changesSincePrevious: null,
    })
  })
})
