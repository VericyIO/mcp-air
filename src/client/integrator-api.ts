import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { MCP_AIR_REQUEST_TIMEOUT_MS } from '../config.js'
import { IntegratorApiError } from '../errors.js'

type RequestOptions = {
  readonly method?: 'GET' | 'POST' | 'DELETE'
  readonly body?: unknown
  readonly query?: Record<string, string | number | boolean | undefined>
}

const buildUrl = (apiUrl: string, pathname: string, query?: RequestOptions['query']): string => {
  const url = new URL(pathname.startsWith('/') ? pathname : `/${pathname}`, `${apiUrl}/`)
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value))
      }
    }
  }
  return url.toString()
}

export class IntegratorApiClient {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
    private readonly requestTimeoutMs: number = MCP_AIR_REQUEST_TIMEOUT_MS,
  ) {}

  async request<T>(pathname: string, options: RequestOptions = {}): Promise<T> {
    const response = await fetch(buildUrl(this.apiUrl, pathname, options.query), {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : null,
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    })

    if (response.status === 204) {
      return undefined as T
    }

    const text = await response.text()
    if (!response.ok) {
      throw new IntegratorApiError(response.status, text)
    }

    if (text.length === 0) {
      return undefined as T
    }

    return JSON.parse(text) as T
  }

  healthCheck() {
    return this.request<{ name: string; status: string; docs: string; openapi: string }>('/')
  }

  listDomains() {
    return this.request<ReadonlyArray<Record<string, unknown>>>('/domains/')
  }

  listProjects(
    domainPid: string,
    query?: {
      page?: number | undefined
      pageSize?: number | undefined
      search?: string | undefined
      sortBy?: string | undefined
      sortDirection?: string | undefined
    },
  ) {
    return this.request<Record<string, unknown>>(
      `/domains/${encodeURIComponent(domainPid)}/projects`,
      query !== undefined ? { query } : {},
    )
  }

  createProject(
    domainPid: string,
    payload: { name: string; slug: string; description?: string | null },
  ) {
    return this.request<Record<string, unknown>>(
      `/domains/${encodeURIComponent(domainPid)}/projects`,
      { method: 'POST', body: payload },
    )
  }

  lookupDomain(orgSlug: string, domainSlug: string) {
    return this.request<Record<string, unknown>>(
      `/domains/lookup/${encodeURIComponent(orgSlug)}/${encodeURIComponent(domainSlug)}`,
    )
  }

  lookupProject(orgSlug: string, domainSlug: string, projectSlug: string) {
    return this.request<Record<string, unknown>>(
      `/projects/lookup/${encodeURIComponent(orgSlug)}/${encodeURIComponent(domainSlug)}/${encodeURIComponent(projectSlug)}`,
    )
  }

  listDocuments(projectPid: string, includeArchived?: boolean) {
    return this.request<ReadonlyArray<Record<string, unknown>>>(
      `/projects/${encodeURIComponent(projectPid)}/documents`,
      { query: { includeArchived } },
    )
  }

  listArtifacts(projectPid: string, includeArchived?: boolean) {
    return this.request<ReadonlyArray<Record<string, unknown>>>(
      `/projects/${encodeURIComponent(projectPid)}/artifacts`,
      { query: { includeArchived } },
    )
  }

  getArtifact(projectPid: string, artifactPid: string) {
    return this.request<Record<string, unknown>>(
      `/projects/${encodeURIComponent(projectPid)}/artifacts/${encodeURIComponent(artifactPid)}`,
    )
  }

  getArtifactText(projectPid: string, artifactPid: string) {
    return this.request<Record<string, unknown>>(
      `/projects/${encodeURIComponent(projectPid)}/artifacts/${encodeURIComponent(artifactPid)}/text`,
    )
  }

  getDocumentDownloadUrl(projectPid: string, sourcePid: string) {
    return this.request<Record<string, unknown>>(
      `/projects/${encodeURIComponent(projectPid)}/documents/${encodeURIComponent(sourcePid)}/download`,
    )
  }

  initUpload(projectPid: string, filename: string, contentType: string) {
    return this.request<{ uploadUrl: string; s3Key: string }>(
      `/projects/${encodeURIComponent(projectPid)}/documents/upload-init`,
      { method: 'POST', body: { filename, contentType } },
    )
  }

  completeUpload(
    projectPid: string,
    payload: { s3Key: string; filename: string; contentType: string },
  ) {
    return this.request<{ sourcePid: string; workflowPid: string }>(
      `/projects/${encodeURIComponent(projectPid)}/documents/upload-complete`,
      { method: 'POST', body: payload },
    )
  }

  async uploadFileToPresignedUrl(uploadUrl: string, filePath: string, contentType: string) {
    const resolved = path.resolve(filePath)
    const bytes = await readFile(resolved)
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: bytes,
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new IntegratorApiError(response.status, text)
    }
  }

  listAssessments(projectPid: string) {
    return this.request<ReadonlyArray<Record<string, unknown>>>(
      `/assessments/projects/${encodeURIComponent(projectPid)}`,
    )
  }

  getAssessment(assessmentPid: string) {
    return this.request<Record<string, unknown>>(
      `/assessments/${encodeURIComponent(assessmentPid)}`,
    )
  }

  getAssessmentReport(assessmentPid: string) {
    return this.request<Record<string, unknown>>(
      `/assessments/${encodeURIComponent(assessmentPid)}/report`,
    )
  }

  listAssessmentStages(assessmentPid: string) {
    return this.request<ReadonlyArray<Record<string, unknown>>>(
      `/assessments/${encodeURIComponent(assessmentPid)}/stages`,
    )
  }

  listAssessmentInputArtifacts(assessmentPid: string) {
    return this.request<ReadonlyArray<Record<string, unknown>>>(
      `/assessments/${encodeURIComponent(assessmentPid)}/input-artifacts`,
    )
  }

  startAssessment(projectPid: string, name: string, artifactPids: ReadonlyArray<string>) {
    return this.request<{ assessmentPid: string; workflowRunId: string }>(
      `/assessments/projects/${encodeURIComponent(projectPid)}`,
      { method: 'POST', body: { name, artifactPids } },
    )
  }

  createAssessmentDraft(projectPid: string, name: string, artifactPids: ReadonlyArray<string>) {
    return this.request<{ assessmentPid: string }>(
      `/assessments/projects/${encodeURIComponent(projectPid)}/drafts`,
      { method: 'POST', body: { name, artifactPids } },
    )
  }

  retryAssessment(assessmentPid: string) {
    return this.request<{
      assessmentPid: string
      workflowRunId: string
      resumedFromStage: string | null
    }>(`/assessments/${encodeURIComponent(assessmentPid)}/retry`, { method: 'POST', body: {} })
  }

  terminateAssessment(assessmentPid: string) {
    return this.request<Record<string, unknown>>(
      `/assessments/${encodeURIComponent(assessmentPid)}/terminate`,
      { method: 'POST', body: {} },
    )
  }

  search(q: string, kind?: string, limit?: number) {
    return this.request<ReadonlyArray<Record<string, unknown>>>('/search/', {
      method: 'POST',
      body: { q, kind, limit },
    })
  }

  domainPortfolio(orgSlug: string, domainSlug: string) {
    return this.request<Record<string, unknown>>(
      `/orgs/${encodeURIComponent(orgSlug)}/domains/${encodeURIComponent(domainSlug)}/portfolio`,
    )
  }
}

export const createIntegratorApiClient = (
  apiUrl: string,
  apiKey: string,
  requestTimeoutMs: number = MCP_AIR_REQUEST_TIMEOUT_MS,
) => new IntegratorApiClient(apiUrl, apiKey, requestTimeoutMs)
