import { createHash, randomBytes } from "node:crypto";

import { isTerminal } from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import type {
  CreateTaskOptions,
  TaskStore,
} from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import type {
  Request,
  RequestId,
  Result,
  Task,
} from "@modelcontextprotocol/sdk/types.js";
import type { RedisClientType } from "redis";
import { createClient } from "redis";

/** Redis key prefix for MCP task records. */
export const MCP_AIR_REDIS_TASK_KEY_PREFIX = "mcp-air:task:" as const;

/** Redis sorted-set key for task id listing / pagination. */
export const MCP_AIR_REDIS_TASK_INDEX_KEY_PREFIX = "mcp-air:tasks:" as const;

/** Default page size for Redis-backed listTasks. */
export const MCP_AIR_REDIS_TASK_LIST_PAGE_SIZE = 10 as const;

/** Minimum TTL seconds when converting ms TTL to Redis EXPIRE (at least 1s). */
export const MCP_AIR_REDIS_MIN_TTL_SECONDS = 1 as const;

/** Status message applied when failing orphaned in-flight tasks after restart. */
export const MCP_AIR_ORPHANED_TASK_STATUS_MESSAGE =
  "Task worker lost after MCP host restart" as const;

type StoredTask = {
  readonly task: Task;
  readonly request: Request;
  readonly requestId: RequestId;
  readonly ownerSessionId: string;
  result?: Result;
};

type MutateOutcome =
  | { readonly ok: true; readonly skipped?: boolean }
  | { readonly ok: false; readonly err: "not_found" | "terminal" | "forbidden" };

const MUTATE_TASK_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return cjson.encode({ ok = false, err = 'not_found' })
end

local stored = cjson.decode(raw)
local mode = ARGV[1]
local ownerSessionId = ARGV[2]
local nowIso = ARGV[3]
local expireSeconds = ARGV[4]
local payload = cjson.decode(ARGV[5])

if mode ~= 'fail_orphan' and stored.ownerSessionId ~= ownerSessionId then
  return cjson.encode({ ok = false, err = 'forbidden' })
end

local status = stored.task.status
if status == 'completed' or status == 'failed' or status == 'cancelled' then
  if mode == 'fail_orphan' then
    return cjson.encode({ ok = true, skipped = true })
  end
  return cjson.encode({ ok = false, err = 'terminal' })
end

if mode == 'status' then
  stored.task.status = payload.status
  stored.task.lastUpdatedAt = nowIso
  if payload.statusMessage ~= nil then
    stored.task.statusMessage = payload.statusMessage
  end
elseif mode == 'result' then
  stored.result = payload.result
  stored.task.status = payload.status
  stored.task.lastUpdatedAt = nowIso
elseif mode == 'fail_orphan' then
  stored.result = payload.result
  stored.task.status = 'failed'
  stored.task.statusMessage = payload.statusMessage
  stored.task.lastUpdatedAt = nowIso
else
  return cjson.encode({ ok = false, err = 'not_found' })
end

local encoded = cjson.encode(stored)
if expireSeconds ~= '' then
  redis.call('SET', KEYS[1], encoded, 'EX', tonumber(expireSeconds))
else
  redis.call('SET', KEYS[1], encoded)
end

return cjson.encode({ ok = true })
`;

const taskKey = (taskId: string) => `${MCP_AIR_REDIS_TASK_KEY_PREFIX}${taskId}`;
const taskIndexKey = (sessionId: string) =>
  `${MCP_AIR_REDIS_TASK_INDEX_KEY_PREFIX}${createHash("sha256")
    .update(sessionId, "utf8")
    .digest("hex")}`;

const requireSessionId = (sessionId: string | undefined): string => {
  if (sessionId === undefined || sessionId.length === 0) {
    throw new Error("A valid MCP session ID is required for task operations");
  }
  return sessionId;
};

const ttlSeconds = (ttlMs: number | null | undefined): number | undefined => {
  if (ttlMs === null || ttlMs === undefined || ttlMs <= 0) {
    return undefined;
  }
  return Math.max(MCP_AIR_REDIS_MIN_TTL_SECONDS, Math.ceil(ttlMs / 1_000));
};

const generateTaskId = () => randomBytes(16).toString("hex");

const parseMutateOutcome = (raw: unknown): MutateOutcome => {
  const value =
    typeof raw === "string"
      ? (JSON.parse(raw) as MutateOutcome)
      : (raw as MutateOutcome);
  return value;
};

/**
 * Redis-backed TaskStore for the HTTP MCP host.
 * Persists task records across restarts. In-process workers are not resumed after a restart;
 * orphaned non-terminal tasks are marked failed on startup.
 * Every operation is isolated to the Streamable HTTP session that created the task.
 */
export class RedisTaskStore implements TaskStore {
  private constructor(
    private readonly redis: RedisClientType,
    private readonly ownsConnection: boolean,
  ) {}

  /** Build a store around an already-connected Redis client (tests / custom wiring). */
  static fromClient(redis: RedisClientType): RedisTaskStore {
    return new RedisTaskStore(redis, false);
  }

  static async connect(redisUrl: string): Promise<RedisTaskStore> {
    const redis = createClient({ url: redisUrl }) as RedisClientType;
    redis.on("error", (error) => {
      process.stderr.write(
        `[mcp-air redis] ${error instanceof Error ? error.message : String(error)}\n`,
      );
    });
    await redis.connect();
    return new RedisTaskStore(redis, true);
  }

  async close(): Promise<void> {
    if (this.ownsConnection) {
      await this.redis.quit();
    }
  }

  async isReady(): Promise<boolean> {
    return (await this.redis.ping()) === "PONG";
  }

  private async readStored(
    taskId: string,
    sessionId: string,
  ): Promise<StoredTask | null> {
    const raw = await this.redis.get(taskKey(taskId));
    if (raw === null) {
      return null;
    }
    const stored = JSON.parse(raw) as StoredTask;
    return stored.ownerSessionId === sessionId ? stored : null;
  }

  private async writeStored(
    stored: StoredTask,
    expireSeconds?: number,
  ): Promise<void> {
    const key = taskKey(stored.task.taskId);
    const payload = JSON.stringify(stored);
    if (expireSeconds !== undefined) {
      await this.redis.set(key, payload, { EX: expireSeconds });
    } else {
      await this.redis.set(key, payload);
    }
  }

  private async refreshIndex(
    taskId: string,
    sessionId: string,
    score: number,
  ): Promise<void> {
    await this.redis.zAdd(taskIndexKey(sessionId), { score, value: taskId });
  }

  private mutateInMemory(
    raw: string,
    mode: "status" | "result" | "fail_orphan",
    ownerSessionId: string,
    nowIso: string,
    payload: Record<string, unknown>,
  ): { readonly outcome: MutateOutcome; readonly encoded?: string } {
    const parsed = JSON.parse(raw) as StoredTask;
    if (mode !== "fail_orphan" && parsed.ownerSessionId !== ownerSessionId) {
      return { outcome: { ok: false, err: "forbidden" } };
    }
    if (isTerminal(parsed.task.status)) {
      if (mode === "fail_orphan") {
        return { outcome: { ok: true, skipped: true } };
      }
      return { outcome: { ok: false, err: "terminal" } };
    }

    let next: StoredTask;
    if (mode === "status") {
      next = {
        ...parsed,
        task: {
          ...parsed.task,
          status: payload.status as Task["status"],
          lastUpdatedAt: nowIso,
          ...(typeof payload.statusMessage === "string"
            ? { statusMessage: payload.statusMessage }
            : {}),
        },
      };
    } else if (mode === "result") {
      next = {
        ...parsed,
        result: payload.result as Result,
        task: {
          ...parsed.task,
          status: payload.status as "completed" | "failed",
          lastUpdatedAt: nowIso,
        },
      };
    } else {
      next = {
        ...parsed,
        result: payload.result as Result,
        task: {
          ...parsed.task,
          status: "failed",
          statusMessage:
            typeof payload.statusMessage === "string"
              ? payload.statusMessage
              : MCP_AIR_ORPHANED_TASK_STATUS_MESSAGE,
          lastUpdatedAt: nowIso,
        },
      };
    }

    return { outcome: { ok: true }, encoded: JSON.stringify(next) };
  }

  private async mutateTask(
    taskId: string,
    mode: "status" | "result" | "fail_orphan",
    ownerSessionId: string,
    payload: Record<string, unknown>,
    expireSeconds?: number,
  ): Promise<MutateOutcome> {
    const key = taskKey(taskId);
    const nowIso = new Date().toISOString();
    const args = [
      mode,
      ownerSessionId,
      nowIso,
      expireSeconds === undefined ? "" : String(expireSeconds),
      JSON.stringify(payload),
    ];

    if (typeof this.redis.eval === "function") {
      try {
        const raw = await this.redis.eval(MUTATE_TASK_LUA, {
          keys: [key],
          arguments: args,
        });
        return parseMutateOutcome(raw);
      } catch {
        // Fall through to in-memory CAS for test fakes without Lua.
      }
    }

    const existing = await this.redis.get(key);
    if (existing === null) {
      return { ok: false, err: "not_found" };
    }
    const mutated = this.mutateInMemory(
      existing,
      mode,
      ownerSessionId,
      nowIso,
      payload,
    );
    if (!mutated.outcome.ok || mutated.encoded === undefined) {
      return mutated.outcome;
    }
    if (expireSeconds !== undefined) {
      await this.redis.set(key, mutated.encoded, { EX: expireSeconds });
    } else {
      await this.redis.set(key, mutated.encoded);
    }
    return mutated.outcome;
  }

  /**
   * Mark non-terminal tasks left behind by a previous process as failed.
   * Call once after connect, before accepting MCP traffic.
   */
  async failOrphanedWorkingTasks(
    statusMessage = MCP_AIR_ORPHANED_TASK_STATUS_MESSAGE,
  ): Promise<number> {
    let cursor: string | number = "0";
    let failed = 0;
    do {
      const scanResult: { cursor: string | number; keys: string[] } =
        typeof this.redis.scan === "function"
          ? await this.redis.scan(String(cursor), {
              MATCH: `${MCP_AIR_REDIS_TASK_KEY_PREFIX}*`,
              COUNT: 100,
            })
          : { cursor: "0", keys: [] };
      cursor = scanResult.cursor;
      for (const key of scanResult.keys) {
        const raw = await this.redis.get(key);
        if (raw === null) {
          continue;
        }
        const stored = JSON.parse(raw) as StoredTask;
        if (isTerminal(stored.task.status)) {
          continue;
        }
        const outcome = await this.mutateTask(
          stored.task.taskId,
          "fail_orphan",
          stored.ownerSessionId,
          {
            statusMessage,
            result: {
              content: [{ type: "text", text: statusMessage }],
              isError: true,
            },
          },
          ttlSeconds(stored.task.ttl),
        );
        if (outcome.ok && outcome.skipped !== true) {
          failed += 1;
          await this.refreshIndex(
            stored.task.taskId,
            stored.ownerSessionId,
            Date.parse(stored.task.createdAt),
          );
        }
      }
    } while (Number(cursor) !== 0);
    return failed;
  }

  async createTask(
    taskParams: CreateTaskOptions,
    requestId: RequestId,
    request: Request,
    sessionId?: string,
  ): Promise<Task> {
    const ownerSessionId = requireSessionId(sessionId);
    const taskId = generateTaskId();
    const existing = await this.readStored(taskId, ownerSessionId);
    if (existing !== null) {
      throw new Error(`Task with ID ${taskId} already exists`);
    }

    const actualTtl = taskParams.ttl ?? null;
    const createdAt = new Date().toISOString();
    const task: Task = {
      taskId,
      status: "working",
      ttl: actualTtl,
      createdAt,
      lastUpdatedAt: createdAt,
      pollInterval: taskParams.pollInterval ?? 1_000,
    };

    const stored: StoredTask = { task, request, requestId, ownerSessionId };
    const expireSeconds = ttlSeconds(actualTtl);
    await this.writeStored(stored, expireSeconds);
    await this.refreshIndex(taskId, ownerSessionId, Date.parse(createdAt));
    return task;
  }

  async getTask(taskId: string, sessionId?: string): Promise<Task | null> {
    const stored = await this.readStored(taskId, requireSessionId(sessionId));
    return stored === null ? null : { ...stored.task };
  }

  async storeTaskResult(
    taskId: string,
    status: "completed" | "failed",
    result: Result,
    sessionId?: string,
  ): Promise<void> {
    const ownerSessionId = requireSessionId(sessionId);
    const stored = await this.readStored(taskId, ownerSessionId);
    if (stored === null) {
      throw new Error(`Task with ID ${taskId} not found`);
    }
    const expireSeconds = ttlSeconds(stored.task.ttl);
    const outcome = await this.mutateTask(
      taskId,
      "result",
      ownerSessionId,
      { status, result },
      expireSeconds,
    );
    if (!outcome.ok) {
      if (outcome.err === "terminal") {
        throw new Error(
          `Cannot store result for task ${taskId} in terminal status. Task results can only be stored once.`,
        );
      }
      throw new Error(`Task with ID ${taskId} not found`);
    }
    await this.refreshIndex(
      taskId,
      ownerSessionId,
      Date.parse(stored.task.createdAt),
    );
  }

  async getTaskResult(taskId: string, sessionId?: string): Promise<Result> {
    const stored = await this.readStored(taskId, requireSessionId(sessionId));
    if (stored === null) {
      throw new Error(`Task with ID ${taskId} not found`);
    }
    if (stored.result === undefined) {
      throw new Error(`Task ${taskId} has no result stored`);
    }
    return stored.result;
  }

  async updateTaskStatus(
    taskId: string,
    status: Task["status"],
    statusMessage?: string,
    sessionId?: string,
  ): Promise<void> {
    const ownerSessionId = requireSessionId(sessionId);
    const stored = await this.readStored(taskId, ownerSessionId);
    if (stored === null) {
      throw new Error(`Task with ID ${taskId} not found`);
    }
    const expireSeconds = ttlSeconds(stored.task.ttl);
    const outcome = await this.mutateTask(
      taskId,
      "status",
      ownerSessionId,
      {
        status,
        ...(statusMessage !== undefined ? { statusMessage } : {}),
      },
      expireSeconds,
    );
    if (!outcome.ok) {
      if (outcome.err === "terminal") {
        throw new Error(
          `Cannot update task ${taskId} from terminal status to '${status}'. Terminal states (completed, failed, cancelled) cannot transition to other states.`,
        );
      }
      throw new Error(`Task with ID ${taskId} not found`);
    }
    await this.refreshIndex(
      taskId,
      ownerSessionId,
      Date.parse(stored.task.createdAt),
    );
  }

  async listTasks(
    cursor?: string,
    sessionId?: string,
  ): Promise<{ tasks: Task[]; nextCursor?: string }> {
    const ownerSessionId = requireSessionId(sessionId);
    const indexKey = taskIndexKey(ownerSessionId);
    const allTaskIds = await this.redis.zRange(indexKey, 0, -1);
    let startIndex = 0;
    if (cursor !== undefined) {
      const cursorIndex = allTaskIds.indexOf(cursor);
      if (cursorIndex < 0) {
        throw new Error(`Invalid cursor: ${cursor}`);
      }
      startIndex = cursorIndex + 1;
    }

    const pageTaskIds = allTaskIds.slice(
      startIndex,
      startIndex + MCP_AIR_REDIS_TASK_LIST_PAGE_SIZE,
    );
    const tasks: Task[] = [];
    for (const taskId of pageTaskIds) {
      const stored = await this.readStored(taskId, ownerSessionId);
      if (stored !== null) {
        tasks.push({ ...stored.task });
      } else {
        await this.redis.zRem(indexKey, taskId);
      }
    }

    const nextCursor =
      startIndex + MCP_AIR_REDIS_TASK_LIST_PAGE_SIZE < allTaskIds.length
        ? pageTaskIds[pageTaskIds.length - 1]
        : undefined;

    return nextCursor === undefined ? { tasks } : { tasks, nextCursor };
  }
}
