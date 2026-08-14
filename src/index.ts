#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { envApiKey, resolveApiUrl } from './config.js'
import { CredentialsFileError, credentialsPath, readCredentials } from './credentials.js'
import { createAirMcpServer } from './server.js'
import { StdioSession } from './session.js'

const log = (message: string) => {
  process.stderr.write(`${message}\n`)
}

/**
 * Credential order: the environment wins, then the file this server writes,
 * then setup mode. Setup mode is not an error — without it, the tools that
 * create an account would be unreachable on the surface where nobody has one.
 */
const resolveSession = (): StdioSession => {
  const path = credentialsPath()
  const fromEnv = envApiKey()

  if (fromEnv !== undefined) {
    return new StdioSession(
      {
        apiKey: fromEnv,
        apiUrl: resolveApiUrl(),
        orgSlug: '',
        domainPid: '',
        domainSlug: '',
        createdAt: new Date().toISOString(),
      },
      path,
      'environment',
    )
  }

  try {
    return new StdioSession(readCredentials(path), path, 'file')
  } catch (error) {
    // A damaged file is reported loudly and then treated as no credential, so
    // the person can create an account again instead of a dead server.
    if (error instanceof CredentialsFileError) {
      log(`[mcp-air] ${error.message}`)
      return new StdioSession(undefined, path, 'none')
    }
    throw error
  }
}

const main = async () => {
  const session = resolveSession()
  const apiUrl = session.current?.apiUrl ?? resolveApiUrl()
  const server = createAirMcpServer({ apiUrl, apiKey: () => session.apiKey }, { session })

  const transport = new StdioServerTransport()
  await server.connect(transport)

  log(
    session.isSetupMode
      ? `@thalus-ai/mcp-air connected in setup mode (API: ${apiUrl}). No credential found — run air_create_account, or set AIR_API_KEY.`
      : `@thalus-ai/mcp-air connected (API: ${apiUrl})`,
  )
}

main().catch((error) => {
  log(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
