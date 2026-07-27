import type { IntegratorApiClient } from './integrator-api.js'

type ProjectRow = Record<string, unknown>

type DomainProjectsPage = {
  readonly items?: ReadonlyArray<ProjectRow>
  readonly page?: number
  readonly totalPages?: number
}

export const findProjectByPid = async (
  api: IntegratorApiClient,
  projectPid: string,
): Promise<ProjectRow | undefined> => {
  const domains = await api.listDomains()

  for (const domain of domains) {
    const domainPid = String(domain.pid)
    let page = 1
    let totalPages = 1

    while (page <= totalPages) {
      const response = (await api.listProjects(domainPid, {
        page,
        pageSize: 100,
      })) as DomainProjectsPage
      const items = response.items ?? []
      const match = items.find((row) => row.pid === projectPid)
      if (match !== undefined) {
        return match
      }

      totalPages = typeof response.totalPages === 'number' ? response.totalPages : 1
      page += 1
    }
  }

  return undefined
}
