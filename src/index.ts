#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { loadMcpAirConfig } from './config.js'
import { createAirMcpServer } from './server.js'

const log = (message: string) => {
  process.stderr.write(`${message}\n`)
}

const main = async () => {
  try {
    const config = loadMcpAirConfig()
    const server = createAirMcpServer(config)
    const transport = new StdioServerTransport()
    await server.connect(transport)
    log(`@thalus-ai/mcp-air connected (API: ${config.apiUrl})`)
  } catch (error) {
    log(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

main().catch((error) => {
  log(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
