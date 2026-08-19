import { MCP_AIR_API_URL_ENV, MCP_AIR_DEFAULT_API_URL } from "./config.js";

/** Environment variable for HTTP bind host. */
export const MCP_AIR_HTTP_HOST_ENV = "MCP_HTTP_HOST" as const;

/** Environment variable for HTTP bind port. */
export const MCP_AIR_HTTP_PORT_ENV = "MCP_HTTP_PORT" as const;

/** Environment variable for MCP HTTP path (no trailing slash). */
export const MCP_AIR_HTTP_PATH_ENV = "MCP_HTTP_PATH" as const;

/** Default HTTP path for Streamable MCP. */
export const MCP_AIR_DEFAULT_HTTP_PATH = "/mcp" as const;

/** Default HTTP port for remote MCP (dev). */
export const MCP_AIR_DEFAULT_HTTP_PORT = 4104 as const;

/** Default HTTP bind host behind Angie. */
export const MCP_AIR_DEFAULT_HTTP_HOST = "127.0.0.1" as const;

/** OAuth introspection client id for MCP host → air-api. */
export const MCP_AIR_OAUTH_INTROSPECT_CLIENT_ID_ENV =
  "OAUTH_INTROSPECT_CLIENT_ID" as const;

/** OAuth introspection client secret for MCP host → air-api. */
export const MCP_AIR_OAUTH_INTROSPECT_CLIENT_SECRET_ENV =
  "OAUTH_INTROSPECT_CLIENT_SECRET" as const;

/** Optional Redis URL for MCP task state on the HTTP host. */
export const MCP_AIR_REDIS_URL_ENV = "REDIS_URL" as const;

/** Environment variable for this deployment's own public MCP URL. */
export const MCP_AIR_OAUTH_RESOURCE_ENV = "MCP_OAUTH_RESOURCE" as const;

/**
 * Protected-resource metadata URL advertised in 401 responses.
 *
 * Derived from the API this deployment actually talks to rather than pinned to
 * production, because the AIR API is both the upstream and the metadata host, and
 * two sources of truth for one origin is how a dev deployment ends up pointing
 * half of its OAuth discovery at production.
 */
export const protectedResourceMetadataUrl = (apiUrl: string): string =>
  `${apiUrl.replace(/\/$/, "")}/.well-known/oauth-protected-resource`;

/**
 * Audience required on OAuth access tokens accepted by the hosted MCP resource:
 * this deployment's own public URL, which a token is minted for.
 *
 * Overridable because it identifies a deployment, not the product. Hardcoded, a
 * server running anywhere but production demands production-audience tokens and
 * no OAuth flow against another environment can succeed.
 */
export const MCP_AIR_OAUTH_RESOURCE_IDENTIFIER =
  "https://mcp.air.thalus.ai/mcp" as const;

/**
 * Scope requested via `WWW-Authenticate`. The remote tool surface spans uploads, project
 * creation, search, and portfolio, so `fullPipeline` is the preset that actually covers it.
 */
export const MCP_AIR_OAUTH_REQUIRED_SCOPE = "fullPipeline" as const;

export type McpAirHttpRuntimeConfig = {
  readonly apiUrl: string;
  readonly httpHost: string;
  readonly httpPort: number;
  readonly httpPath: string;
  readonly mcpResourceIdentifier: string;
  readonly oauthIntrospectClientId?: string;
  readonly oauthIntrospectClientSecret?: string;
  readonly redisUrl?: string;
};

const parsePort = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${MCP_AIR_HTTP_PORT_ENV} must be a valid TCP port`);
  }
  return parsed;
};

export const loadMcpAirHttpRuntimeConfig = (
  env: NodeJS.ProcessEnv = process.env,
): McpAirHttpRuntimeConfig => {
  const rawApiUrl = env[MCP_AIR_API_URL_ENV]?.trim();
  const apiUrl =
    rawApiUrl !== undefined && rawApiUrl.length > 0
      ? rawApiUrl.replace(/\/$/, "")
      : MCP_AIR_DEFAULT_API_URL;

  const httpHost =
    env[MCP_AIR_HTTP_HOST_ENV]?.trim() || MCP_AIR_DEFAULT_HTTP_HOST;
  const httpPort = parsePort(
    env[MCP_AIR_HTTP_PORT_ENV],
    MCP_AIR_DEFAULT_HTTP_PORT,
  );
  const httpPath =
    env[MCP_AIR_HTTP_PATH_ENV]?.trim() || MCP_AIR_DEFAULT_HTTP_PATH;

  const oauthIntrospectClientId =
    env[MCP_AIR_OAUTH_INTROSPECT_CLIENT_ID_ENV]?.trim();
  const oauthIntrospectClientSecret =
    env[MCP_AIR_OAUTH_INTROSPECT_CLIENT_SECRET_ENV]?.trim();
  const redisUrl = env[MCP_AIR_REDIS_URL_ENV]?.trim();

  const rawResource = env[MCP_AIR_OAUTH_RESOURCE_ENV]?.trim();
  const resourceIdentifier =
    rawResource !== undefined && rawResource.length > 0
      ? rawResource.replace(/\/$/, "")
      : MCP_AIR_OAUTH_RESOURCE_IDENTIFIER;

  return {
    apiUrl,
    httpHost,
    httpPort,
    httpPath,
    mcpResourceIdentifier: resourceIdentifier,
    ...(oauthIntrospectClientId !== undefined &&
    oauthIntrospectClientId.length > 0
      ? { oauthIntrospectClientId }
      : {}),
    ...(oauthIntrospectClientSecret !== undefined &&
    oauthIntrospectClientSecret.length > 0
      ? { oauthIntrospectClientSecret }
      : {}),
    ...(redisUrl !== undefined && redisUrl.length > 0 ? { redisUrl } : {}),
  };
};
