import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

export const supportsElicitation = (server: McpServer): boolean =>
  server.server.getClientCapabilities()?.elicitation !== undefined
