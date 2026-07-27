import { describe, expect, it, vi } from 'vitest'

import { findProjectByPid } from '../src/client/find-project.js'
import type { IntegratorApiClient } from '../src/client/integrator-api.js'
import { scopeHintForTool } from '../src/errors.js'

describe('findProjectByPid', () => {
  it('searches paginated domain project lists', async () => {
    const api = {
      listDomains: vi.fn().mockResolvedValue([{ pid: 'dom_abc' }]),
      listProjects: vi
        .fn()
        .mockResolvedValueOnce({
          items: [{ pid: 'proj_other', name: 'Other' }],
          page: 1,
          totalPages: 2,
        })
        .mockResolvedValueOnce({
          items: [{ pid: 'proj_target', name: 'Target' }],
          page: 2,
          totalPages: 2,
        }),
    } as unknown as IntegratorApiClient

    const match = await findProjectByPid(api, 'proj_target')

    expect(match).toEqual({ pid: 'proj_target', name: 'Target' })
    expect(api.listProjects).toHaveBeenCalledTimes(2)
  })

  it('returns undefined when project is not visible', async () => {
    const api = {
      listDomains: vi.fn().mockResolvedValue([{ pid: 'dom_abc' }]),
      listProjects: vi.fn().mockResolvedValue({ items: [], page: 1, totalPages: 1 }),
    } as unknown as IntegratorApiClient

    await expect(findProjectByPid(api, 'proj_missing')).resolves.toBeUndefined()
  })
})

describe('scopeHintForTool', () => {
  it('documents fullPipeline for upload tools', () => {
    expect(scopeHintForTool('air_upload_document_init')).toContain('fullPipeline')
  })

  it('documents fullPipeline for domain portfolio', () => {
    expect(scopeHintForTool('air_get_domain_portfolio')).toContain('fullPipeline')
  })

  it('documents fullPipeline for create project', () => {
    expect(scopeHintForTool('air_create_project')).toContain('domains:write')
  })
})
