import { randomUUID } from "node:crypto";

import { InMemoryTaskStore } from "@modelcontextprotocol/sdk/experimental/tasks";
import type { TaskStore } from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Express, Request, Response } from "express";

import {
  McpAuthUpstreamError,
  resolveMcpCredentials,
  unauthorizedWwwAuthenticateHeader,
} from "./auth.js";
import type { McpAirHttpRuntimeConfig } from "./http-config.js";
import { RedisTaskStore } from "./redis-task-store.js";
import { createAirMcpServer } from "./server.js";

type SessionEntry = {
  readonly transport: StreamableHTTPServerTransport;
  readonly identity: string;
  lastSeenAt: number;
};

/**
 * Clients are not required to DELETE a session when they are done with it, so idle
 * sessions are reaped instead of accumulating transports for the process lifetime.
 */
const SESSION_IDLE_TIMEOUT_MS = 60 * 60_000;
const SESSION_SWEEP_INTERVAL_MS = 5 * 60_000;

const jsonRpcError = (status: number, message: string) => ({
  jsonrpc: "2.0" as const,
  error: { code: -32_000, message },
  id: null,
});

const sendUnauthorized = (res: Response, invalidToken = false) => {
  res
    .status(401)
    .set("WWW-Authenticate", unauthorizedWwwAuthenticateHeader(invalidToken))
    .json(jsonRpcError(401, "Unauthorized"));
};

export type McpAirHttpApp = {
  readonly app: Express;
  readonly close: () => Promise<void>;
};

export const createMcpAirHttpApp = async (
  config: McpAirHttpRuntimeConfig,
): Promise<McpAirHttpApp> => {
  const sessions = new Map<string, SessionEntry>();
  const app = createMcpExpressApp({
    host: config.httpHost,
    allowedHosts: [
      ...new Set([
        config.httpHost,
        "127.0.0.1",
        "localhost",
        "[::1]",
        "mcp.air.thalus.ai",
      ]),
    ],
  });

  let redisTaskStore: RedisTaskStore | undefined;
  let sharedTaskStore: TaskStore | undefined;

  if (config.redisUrl !== undefined) {
    redisTaskStore = await RedisTaskStore.connect(config.redisUrl);
    const orphaned = await redisTaskStore.failOrphanedWorkingTasks();
    if (orphaned > 0) {
      process.stderr.write(
        `[mcp-air] marked ${orphaned} orphaned Redis task(s) failed after restart\n`,
      );
    }
    sharedTaskStore = redisTaskStore;
  }

  app.get("/health", async (_req, res) => {
    const oauthConfigured =
      config.oauthIntrospectClientId !== undefined &&
      config.oauthIntrospectClientSecret !== undefined;
    const redisReady =
      redisTaskStore === undefined
        ? config.redisUrl === undefined
        : await redisTaskStore.isReady();
    if (!oauthConfigured || !redisReady) {
      res.status(503).send("not ready");
      return;
    }
    res.status(200).send("ok");
  });

  const handleMcp = async (req: Request, res: Response) => {
    try {
      const authorizationHeader = req.headers.authorization;
      const credentials = await resolveMcpCredentials(
        config,
        authorizationHeader,
      );
      if (credentials === undefined) {
        sendUnauthorized(res, authorizationHeader !== undefined);
        return;
      }

      const sessionIdHeader = req.headers["mcp-session-id"];
      const sessionId =
        typeof sessionIdHeader === "string" ? sessionIdHeader : undefined;
      let entry: SessionEntry | undefined =
        sessionId !== undefined ? sessions.get(sessionId) : undefined;

      if (
        entry === undefined &&
        sessionId === undefined &&
        isInitializeRequest(req.body)
      ) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (initializedSessionId) => {
            sessions.set(initializedSessionId, {
              transport,
              identity: credentials.identity,
              lastSeenAt: Date.now(),
            });
          },
          onsessionclosed: (closedSessionId) => {
            sessions.delete(closedSessionId);
          },
        });

        const server = createAirMcpServer(
          { apiUrl: config.apiUrl, apiKey: credentials.apiKey },
          {
            surface: "remote",
            taskStore: sharedTaskStore ?? new InMemoryTaskStore(),
          },
        );

        transport.onclose = () => {
          void server.close();
        };

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      if (entry === undefined) {
        const status = sessionId === undefined ? 400 : 404;
        res
          .status(status)
          .json(
            jsonRpcError(
              status,
              sessionId === undefined
                ? "Bad Request: No session ID provided"
                : "Session not found",
            ),
          );
        return;
      }

      if (entry.identity !== credentials.identity) {
        sendUnauthorized(res, true);
        return;
      }

      entry.lastSeenAt = Date.now();
      await entry.transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) {
        const status = error instanceof McpAuthUpstreamError ? 503 : 500;
        res
          .status(status)
          .json(
            jsonRpcError(
              status,
              status === 503
                ? "Authentication service unavailable"
                : "Internal server error",
            ),
          );
      }
    }
  };

  app.post(config.httpPath, handleMcp);
  app.get(config.httpPath, handleMcp);
  app.delete(config.httpPath, handleMcp);

  const sweep = setInterval(() => {
    const cutoff = Date.now() - SESSION_IDLE_TIMEOUT_MS;
    for (const [sessionId, entry] of sessions) {
      if (entry.lastSeenAt < cutoff) {
        sessions.delete(sessionId);
        void entry.transport.close();
      }
    }
  }, SESSION_SWEEP_INTERVAL_MS);
  sweep.unref();

  return {
    app,
    close: async () => {
      clearInterval(sweep);
      await Promise.all(
        [...sessions.values()].map(({ transport }) => transport.close()),
      );
      sessions.clear();
      if (redisTaskStore !== undefined) {
        await redisTaskStore.close();
      }
    },
  };
};

export const startMcpAirHttpServer = async (
  config: McpAirHttpRuntimeConfig,
) => {
  const { app, close } = await createMcpAirHttpApp(config);

  return new Promise<void>((resolve, reject) => {
    const server = app.listen(
      config.httpPort,
      config.httpHost,
      (error?: Error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      },
    );

    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      void close().finally(() => {
        server.close(() => {
          process.exit(0);
        });
      });
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
};
