import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { findProjectByPid } from '../client/find-project.js'
import type { IntegratorApiClient } from '../client/integrator-api.js'
import { MCP_AIR_DEFAULT_LIST_LIMIT } from '../config.js'
import { toolErrorResult, toolJsonResult } from '../errors.js'

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const

const writeHint = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
} as const

export const registerDiscoverTools = (server: McpServer, api: IntegratorApiClient) => {
  server.tool(
    'air_list_domains',
    'List domains visible to the API key. For domain-scoped service account keys, returns the single bound domain. Requires domains:read scope.',
    {},
    readOnly,
    async () => {
      try {
        return toolJsonResult(await api.listDomains())
      } catch (error) {
        return toolErrorResult(error, 'air_list_domains')
      }
    },
  )

  server.tool(
    'air_get_domain',
    'Resolve a domain by pid from air_list_domains results, or by orgSlug + domainSlug via slug lookup.',
    {
      domainPid: z.string().optional().describe('Domain pid from air_list_domains'),
      orgSlug: z.string().optional().describe('Organization slug for lookup'),
      domainSlug: z.string().optional().describe('Domain slug for lookup'),
    },
    readOnly,
    async ({ domainPid, orgSlug, domainSlug }) => {
      try {
        if (orgSlug !== undefined && domainSlug !== undefined) {
          return toolJsonResult(await api.lookupDomain(orgSlug, domainSlug))
        }
        if (domainPid === undefined) {
          return toolErrorResult(
            new Error('Provide domainPid or both orgSlug and domainSlug'),
            'air_get_domain',
          )
        }
        const domains = await api.listDomains()
        const match = domains.find((row) => row.pid === domainPid)
        if (match === undefined) {
          return toolErrorResult(new Error(`Domain ${domainPid} not found`), 'air_get_domain')
        }
        return toolJsonResult(match)
      } catch (error) {
        return toolErrorResult(error, 'air_get_domain')
      }
    },
  )

  server.tool(
    'air_list_projects',
    'List projects in a domain (paginated). Requires domains:read and projects:read. Use domainPid from air_list_domains.',
    {
      domainPid: z.string().describe('Domain pid'),
      page: z.number().int().min(1).optional().describe('Page number (default 1)'),
      pageSize: z.number().int().min(1).max(100).optional().describe('Page size (default 20)'),
      search: z.string().optional().describe('Filter projects by name'),
    },
    readOnly,
    async ({ domainPid, page, pageSize, search }) => {
      try {
        const query = {
          ...(page !== undefined ? { page } : {}),
          ...(pageSize !== undefined ? { pageSize } : {}),
          ...(search !== undefined ? { search } : {}),
        }
        return toolJsonResult(await api.listProjects(domainPid, query))
      } catch (error) {
        return toolErrorResult(error, 'air_list_projects')
      }
    },
  )

  server.tool(
    'air_get_project',
    'Resolve a project by pid from air_list_projects, or by orgSlug + domainSlug + projectSlug.',
    {
      projectPid: z.string().optional().describe('Project pid from air_list_projects'),
      orgSlug: z.string().optional(),
      domainSlug: z.string().optional(),
      projectSlug: z.string().optional(),
    },
    readOnly,
    async ({ projectPid, orgSlug, domainSlug, projectSlug }) => {
      try {
        if (orgSlug !== undefined && domainSlug !== undefined && projectSlug !== undefined) {
          return toolJsonResult(await api.lookupProject(orgSlug, domainSlug, projectSlug))
        }
        if (projectPid === undefined) {
          return toolErrorResult(
            new Error('Provide projectPid or orgSlug + domainSlug + projectSlug'),
            'air_get_project',
          )
        }
        const match = await findProjectByPid(api, projectPid)
        if (match === undefined) {
          return toolErrorResult(new Error(`Project ${projectPid} not found`), 'air_get_project')
        }
        return toolJsonResult(match)
      } catch (error) {
        return toolErrorResult(error, 'air_get_project')
      }
    },
  )

  server.tool(
    'air_create_project',
    'Create a project in a domain. Requires domains:write (fullPipeline preset). Returns project pid and slug.',
    {
      domainPid: z.string().describe('Domain pid from air_list_domains'),
      name: z.string().min(1).describe('Display name for the project'),
      slug: z.string().min(1).describe('URL-safe slug (unique within the domain)'),
      description: z.string().optional().describe('Optional project description'),
    },
    writeHint,
    async ({ domainPid, name, slug, description }) => {
      try {
        return toolJsonResult(
          await api.createProject(domainPid, {
            name,
            slug,
            ...(description !== undefined ? { description } : {}),
          }),
        )
      } catch (error) {
        return toolErrorResult(error, 'air_create_project')
      }
    },
  )

  server.tool(
    'air_search',
    'Full-text search across orgs, domains, and projects. Requires search:read scope (fullPipeline preset; not included in assessmentRunner).',
    {
      q: z.string().min(1).describe('Search query'),
      kind: z.enum(['org', 'domain', 'project']).optional().describe('Restrict to entity kind'),
      limit: z.number().int().min(1).max(50).optional().describe('Max results (default 20)'),
    },
    readOnly,
    async ({ q, kind, limit }) => {
      try {
        const resolvedLimit = limit ?? MCP_AIR_DEFAULT_LIST_LIMIT
        return toolJsonResult(await api.search(q, kind, resolvedLimit))
      } catch (error) {
        return toolErrorResult(error, 'air_search')
      }
    },
  )
}
