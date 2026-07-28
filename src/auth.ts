import { MCP_AIR_OAUTH_PROTECTED_RESOURCE_METADATA_URL } from './http-config.js'
import type { McpAirHttpRuntimeConfig } from './http-config.js'

const DOMAIN_API_KEY_PATTERN =
  /^air_[A-Za-z0-9_-]+\.(ak_[1-9A-HJ-NP-Za-km-z]{16})\.[A-Za-z0-9_-]{32,}$/

export type ResolvedMcpCredentials = {
  readonly apiKey: string
}

type IntrospectionResponse = {
  readonly active?: boolean
  readonly api_key?: string
}

const readBearerToken = (authorizationHeader: string | undefined): string | undefined => {
  if (authorizationHeader === undefined) {
    return undefined
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim())
  return match?.[1]?.trim()
}

const introspectOAuthToken = async (
  config: McpAirHttpRuntimeConfig,
  token: string,
): Promise<ResolvedMcpCredentials | undefined> => {
  const clientId = config.oauthIntrospectClientId
  const clientSecret = config.oauthIntrospectClientSecret
  if (clientId === undefined || clientSecret === undefined) {
    throw new Error(
      'OAuth introspection is not configured. Set OAUTH_INTROSPECT_CLIENT_ID and OAUTH_INTROSPECT_CLIENT_SECRET.',
    )
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')
  const response = await fetch(`${config.apiUrl}/oauth/introspect`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ token }),
  })

  if (!response.ok) {
    return undefined
  }

  const body = (await response.json()) as IntrospectionResponse
  if (body.active !== true || body.api_key === undefined || body.api_key.length === 0) {
    return undefined
  }

  return { apiKey: body.api_key }
}

export const resolveMcpCredentials = async (
  config: McpAirHttpRuntimeConfig,
  authorizationHeader: string | undefined,
): Promise<ResolvedMcpCredentials | undefined> => {
  const token = readBearerToken(authorizationHeader)
  if (token === undefined || token.length === 0) {
    return undefined
  }

  if (DOMAIN_API_KEY_PATTERN.test(token)) {
    return { apiKey: token }
  }

  return introspectOAuthToken(config, token)
}

export const unauthorizedWwwAuthenticateHeader = (): string =>
  `Bearer realm="AIR MCP", resource_metadata="${MCP_AIR_OAUTH_PROTECTED_RESOURCE_METADATA_URL}"`
