#!/usr/bin/env node
import { loadMcpAirHttpRuntimeConfig } from './http-config.js'
import { startMcpAirHttpServer } from './http-server.js'

const log = (message: string) => {
  process.stderr.write(`${message}\n`)
}

const main = async () => {
  try {
    const config = loadMcpAirHttpRuntimeConfig()
    await startMcpAirHttpServer(config)
    log(
      `@thalus-ai/mcp-air HTTP listening on http://${config.httpHost}:${config.httpPort}${config.httpPath} (API: ${config.apiUrl})`,
    )
  } catch (error) {
    log(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

main().catch((error) => {
  log(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
