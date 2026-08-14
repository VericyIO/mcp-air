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

/**
 * A fixed key for stdio, or a resolver for the hosted transport, where a session
 * may start anonymous and gain a token once the user connects.
 */
export type IntegratorApiCredential = string | (() => string | undefined)

export class IntegratorApiClient {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: IntegratorApiCredential,
    private readonly requestTimeoutMs: number = MCP_AIR_REQUEST_TIMEOUT_MS,
  ) {}

  /** The origin a stored credential belongs to, so a key is never reused elsewhere. */
  apiUrlForStorage(): string {
    return this.apiUrl
  }

  /** Undefined on the hosted transport before the user has connected. */
  resolveApiKey(): string | undefined {
    const key = typeof this.apiKey === 'function' ? this.apiKey() : this.apiKey
    return key !== undefined && key.length > 0 ? key : undefined
  }

  async request<T>(pathname: string, options: RequestOptions = {}): Promise<T> {
    // A public endpoint must be called with no Authorization header at all. The
    // transport's auth gate is what keeps protected tools from arriving here
    // without a key.
    const apiKey = this.resolveApiKey()
    const response = await fetch(buildUrl(this.apiUrl, pathname, options.query), {
      method: options.method ?? 'GET',
      headers: {
        ...(apiKey === undefined ? {} : { Authorization: `Bearer ${apiKey}` }),
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

  listOpenFacts(assessmentPid: string) {
    return this.request<Record<string, unknown>>(
      `/assessments/${encodeURIComponent(assessmentPid)}/open-facts`,
    )
  }

  submitFactAnswers(
    assessmentPid: string,
    answers: ReadonlyArray<{
      factPath: string
      value: boolean | ReadonlyArray<string> | null
      justification?: string | undefined
      evidenceChunkIds?: ReadonlyArray<string> | undefined
    }>,
  ) {
    return this.request<Record<string, unknown>>(
      `/assessments/${encodeURIComponent(assessmentPid)}/fact-answers`,
      { method: 'POST', body: { answers } },
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

  /** Unauthenticated by design: this is the path to a first credential. */
  agentSignup(payload: {
    readonly name: string
    readonly email: string
    readonly orgName: string
    readonly client: { readonly name: string; readonly version: string }
    readonly mcpAirVersion?: string
  }) {
    return this.request<Record<string, unknown>>('/onboarding/agent/signup', {
      method: 'POST',
      body: payload,
    })
  }

  agentVerifyEmail(payload: {
    readonly continuationToken: string
    readonly otp: string
    readonly termsVersion: string
    readonly acceptTerms: boolean
  }) {
    return this.request<Record<string, unknown>>('/onboarding/agent/verify-email', {
      method: 'POST',
      body: payload,
    })
  }

  creditBalance() {
    return this.request<Record<string, unknown>>('/billing/credits')
  }

  creditPurchaseLink() {
    return this.request<Record<string, unknown>>('/billing/credit-purchase-link', {
      method: 'POST',
      body: {},
    })
  }

  requestCredits(payload: {
    readonly credits: number
    readonly reason: string
    readonly contactEmail?: string
    readonly context?: Record<string, unknown>
  }) {
    return this.request<Record<string, unknown>>('/support/credit-request', {
      method: 'POST',
      body: payload,
    })
  }

  submitFeedback(payload: {
    readonly category: string
    readonly message: string
    readonly contactEmail?: string
    readonly context?: Record<string, unknown>
  }) {
    return this.request<Record<string, unknown>>('/support/feedback', {
      method: 'POST',
      body: payload,
    })
  }

  /** No credential: the path for someone whose signup never completed. */
  submitPublicFeedback(payload: {
    readonly category: string
    readonly message: string
    readonly contactEmail: string
  }) {
    return this.request<Record<string, unknown>>('/support/feedback/public', {
      method: 'POST',
      body: payload,
    })
  }
}

export const createIntegratorApiClient = (
  apiUrl: string,
  apiKey: IntegratorApiCredential,
  requestTimeoutMs: number = MCP_AIR_REQUEST_TIMEOUT_MS,
) => new IntegratorApiClient(apiUrl, apiKey, requestTimeoutMs)
