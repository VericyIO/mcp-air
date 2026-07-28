import { randomUUID } from 'node:crypto'

import { InMemoryTaskStore } from '@modelcontextprotocol/sdk/experimental/tasks'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import type { Express, Request, Response } from 'express'

import { resolveMcpCredentials, unauthorizedWwwAuthenticateHeader } from './auth.js'
import type { McpAirHttpRuntimeConfig } from './http-config.js'
import { createAirMcpServer } from './server.js'

type SessionEntry = {
  readonly transport: StreamableHTTPServerTransport
}

const jsonRpcError = (status: number, message: string) => ({
  jsonrpc: '2.0' as const,
  error: { code: -32_000, message },
  id: null,
})

const sendUnauthorized = (res: Response) => {
  res
    .status(401)
    .set('WWW-Authenticate', unauthorizedWwwAuthenticateHeader())
    .json(jsonRpcError(401, 'Unauthorized'))
}

export const createMcpAirHttpApp = (config: McpAirHttpRuntimeConfig): Express => {
  const sessions = new Map<string, SessionEntry>()
  const app = createMcpExpressApp({ host: config.httpHost })

  app.get('/health', (_req, res) => {
    res.status(200).send('ok')
  })

  const handleMcp = async (req: Request, res: Response) => {
    try {
      const sessionIdHeader = req.headers['mcp-session-id']
      const sessionId = typeof sessionIdHeader === 'string' ? sessionIdHeader : undefined
      let entry: SessionEntry | undefined =
        sessionId !== undefined ? sessions.get(sessionId) : undefined

      if (entry === undefined && sessionId === undefined && isInitializeRequest(req.body)) {
        const credentials = await resolveMcpCredentials(config, req.headers.authorization)
        if (credentials === undefined) {
          sendUnauthorized(res)
          return
        }

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (initializedSessionId) => {
            sessions.set(initializedSessionId, { transport })
          },
          onsessionclosed: (closedSessionId) => {
            sessions.delete(closedSessionId)
          },
        })

        const taskStore = new InMemoryTaskStore()
        const server = createAirMcpServer(
          { apiUrl: config.apiUrl, apiKey: credentials.apiKey },
          { surface: 'remote', taskStore },
        )

        transport.onclose = () => {
          void server.close()
        }

        await server.connect(transport)
        entry = { transport }
        await transport.handleRequest(req, res, req.body)
        return
      }

      if (entry === undefined) {
        res.status(400).json(jsonRpcError(400, 'Bad Request: No valid session ID provided'))
        return
      }

      const credentials = await resolveMcpCredentials(config, req.headers.authorization)
      if (credentials === undefined) {
        sendUnauthorized(res)
        return
      }

      await entry.transport.handleRequest(req, res, req.body)
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json(jsonRpcError(500, error instanceof Error ? error.message : String(error)))
      }
    }
  }

  app.post(config.httpPath, handleMcp)
  app.get(config.httpPath, handleMcp)

  return app
}

export const startMcpAirHttpServer = (config: McpAirHttpRuntimeConfig) => {
  const app = createMcpAirHttpApp(config)

  return new Promise<void>((resolve, reject) => {
    const server = app.listen(config.httpPort, config.httpHost, (error?: Error) => {
      if (error !== undefined) {
        reject(error)
        return
      }
      resolve()
    })

    const shutdown = () => {
      server.close(() => {
        process.exit(0)
      })
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  })
}
