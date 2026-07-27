import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export const registerAssessmentPrompts = (server: McpServer) => {
  server.prompt(
    'run-assessment-workflow',
    'Guide through discover → upload → extract → assess → report using AIR MCP tools',
    {
      projectPid: z.string().optional().describe('Known project pid to skip discovery'),
    },
    async ({ projectPid }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Run a full AIR risk assessment workflow using the available air_* MCP tools.',
              projectPid !== undefined
                ? `Start from projectPid: ${projectPid}.`
                : 'Begin with air_list_domains and air_list_projects to pick a target project.',
              'Steps:',
              '1. air_list_artifacts (or air_upload_document_init → PUT file → air_upload_document_complete → air_wait_for_document_extraction as an MCP Task)',
              '2. air_start_assessment with up to five artifactPids',
              '3. air_wait_for_assessment (MCP Task) until completed',
              '4. air_get_assessment_report and summarize key risks and EU AI Act tier',
            ].join('\n'),
          },
        },
      ],
    }),
  )

  server.prompt(
    'review-assessment-report',
    'Fetch and summarize an assessment report by assessmentPid',
    {
      assessmentPid: z.string().describe('Assessment pid (pasm_*)'),
    },
    async ({ assessmentPid }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Review AIR assessment ${assessmentPid}.`,
              'Use air_get_assessment_report (or resource air://assessments/{pid}/report).',
              'Summarize: project overview, top risk themes, control gaps, EU AI Act tier, and recommended next steps.',
            ].join('\n'),
          },
        },
      ],
    }),
  )

  server.prompt(
    'explore-portfolio',
    'Explore domain portfolio dashboard for governance gaps (API key access)',
    {
      orgSlug: z.string(),
      domainSlug: z
        .string()
        .describe('Domain slug — org-wide portfolio is portal-only, not available via API keys'),
    },
    async ({ orgSlug, domainSlug }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Fetch domain portfolio for org ${orgSlug}, domain ${domainSlug} via air_get_domain_portfolio.`,
              'Highlight unassessed projects, high-risk themes, and projects needing attention.',
              'For org-wide cross-domain views, use the AIR portal — MCP uses domain-scoped API keys only.',
            ].join('\n'),
          },
        },
      ],
    }),
  )
}
