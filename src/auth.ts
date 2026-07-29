import { createHash } from "node:crypto";

import { MCP_AIR_OAUTH_PROTECTED_RESOURCE_METADATA_URL } from "./http-config.js";
import type { McpAirHttpRuntimeConfig } from "./http-config.js";

const DOMAIN_API_KEY_PATTERN =
  /^air_[A-Za-z0-9_-]+\.(ak_[1-9A-HJ-NP-Za-km-z]{16})\.[A-Za-z0-9_-]{32,}$/;
const AUTH_UPSTREAM_TIMEOUT_MS = 5_000;

export type ResolvedMcpCredentials = {
  readonly apiKey: string;
  readonly identity: string;
};

type IntrospectionResponse = {
  readonly active?: boolean;
  readonly api_key?: string;
  readonly aud?: string | ReadonlyArray<string>;
};

export class McpAuthUpstreamError extends Error {}

const readBearerToken = (
  authorizationHeader: string | undefined,
): string | undefined => {
  if (authorizationHeader === undefined) {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  return match?.[1]?.trim();
};

const identityForApiKey = (apiKey: string): string =>
  createHash("sha256").update(apiKey, "utf8").digest("hex");

const hasExpectedAudience = (
  audience: IntrospectionResponse["aud"],
  expected: string,
): boolean =>
  typeof audience === "string"
    ? audience === expected
    : Array.isArray(audience) && audience.includes(expected);

const fetchAuthEndpoint = async (
  input: string | URL,
  init: RequestInit,
): Promise<Response> => {
  try {
    return await fetch(input, {
      ...init,
      signal: AbortSignal.timeout(AUTH_UPSTREAM_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new McpAuthUpstreamError(
      "AIR authentication service is unavailable",
      { cause },
    );
  }
};

const introspectOAuthToken = async (
  config: McpAirHttpRuntimeConfig,
  token: string,
): Promise<ResolvedMcpCredentials | undefined> => {
  const clientId = config.oauthIntrospectClientId;
  const clientSecret = config.oauthIntrospectClientSecret;
  if (clientId === undefined || clientSecret === undefined) {
    throw new McpAuthUpstreamError(
      "OAuth introspection is not configured. Set OAUTH_INTROSPECT_CLIENT_ID and OAUTH_INTROSPECT_CLIENT_SECRET.",
    );
  }

  const credentials = Buffer.from(
    `${clientId}:${clientSecret}`,
    "utf8",
  ).toString("base64");
  const response = await fetchAuthEndpoint(
    `${config.apiUrl}/oauth/introspect`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token }),
    },
  );

  if (!response.ok) {
    throw new McpAuthUpstreamError(
      `AIR token introspection failed with HTTP ${String(response.status)}`,
    );
  }

  let body: IntrospectionResponse;
  try {
    body = (await response.json()) as IntrospectionResponse;
  } catch (cause) {
    throw new McpAuthUpstreamError(
      "AIR token introspection returned invalid JSON",
      { cause },
    );
  }

  if (
    body.active !== true ||
    body.api_key === undefined ||
    body.api_key.length === 0 ||
    !hasExpectedAudience(body.aud, config.mcpResourceIdentifier)
  ) {
    return undefined;
  }

  return { apiKey: body.api_key, identity: identityForApiKey(body.api_key) };
};

const verifyDomainApiKey = async (
  config: McpAirHttpRuntimeConfig,
  apiKey: string,
): Promise<ResolvedMcpCredentials | undefined> => {
  const response = await fetchAuthEndpoint(
    new URL("/domains/", `${config.apiUrl}/`),
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    },
  );

  if (response.status === 401 || response.status === 403) {
    return undefined;
  }
  if (!response.ok) {
    throw new McpAuthUpstreamError(
      `AIR API-key verification failed with HTTP ${String(response.status)}`,
    );
  }

  return { apiKey, identity: identityForApiKey(apiKey) };
};

export const resolveMcpCredentials = async (
  config: McpAirHttpRuntimeConfig,
  authorizationHeader: string | undefined,
): Promise<ResolvedMcpCredentials | undefined> => {
  const token = readBearerToken(authorizationHeader);
  if (token === undefined || token.length === 0) {
    return undefined;
  }

  if (DOMAIN_API_KEY_PATTERN.test(token)) {
    return verifyDomainApiKey(config, token);
  }

  return introspectOAuthToken(config, token);
};

export const unauthorizedWwwAuthenticateHeader = (
  invalidToken = false,
): string =>
  `Bearer realm="AIR MCP", resource_metadata="${MCP_AIR_OAUTH_PROTECTED_RESOURCE_METADATA_URL}"${
    invalidToken ? ', error="invalid_token"' : ""
  }`;
