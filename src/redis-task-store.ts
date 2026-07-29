import { randomBytes } from 'node:crypto'

import { isTerminal } from '@modelcontextprotocol/sdk/experimental/tasks/interfaces.js'
import type {
  CreateTaskOptions,
  TaskStore,
} from '@modelcontextprotocol/sdk/experimental/tasks/interfaces.js'
import type { Request, RequestId, Result, Task } from '@modelcontextprotocol/sdk/types.js'
import type { RedisClientType } from 'redis'
import { createClient } from 'redis'

/** Redis key prefix for MCP task records. */
export const MCP_AIR_REDIS_TASK_KEY_PREFIX = 'mcp-air:task:' as const

/** Redis sorted-set key for task id listing / pagination. */
export const MCP_AIR_REDIS_TASK_INDEX_KEY = 'mcp-air:tasks' as const

/** Default page size for Redis-backed listTasks. */
export const MCP_AIR_REDIS_TASK_LIST_PAGE_SIZE = 10 as const

/** Minimum TTL seconds when converting ms TTL to Redis EXPIRE (at least 1s). */
export const MCP_AIR_REDIS_MIN_TTL_SECONDS = 1 as const

type StoredTask = {
  readonly task: Task
  readonly request: Request
  readonly requestId: RequestId
  result?: Result
}

const taskKey = (taskId: string) => `${MCP_AIR_REDIS_TASK_KEY_PREFIX}${taskId}`

const ttlSeconds = (ttlMs: number | null | undefined): number | undefined => {
  if (ttlMs === null || ttlMs === undefined || ttlMs <= 0) {
    return undefined
  }
  return Math.max(MCP_AIR_REDIS_MIN_TTL_SECONDS, Math.ceil(ttlMs / 1_000))
}

const generateTaskId = () => randomBytes(16).toString('hex')

/**
 * Redis-backed TaskStore for the HTTP MCP host.
 * Survives process restarts and is shared across Streamable HTTP sessions.
 */
export class RedisTaskStore implements TaskStore {
  private constructor(
    private readonly redis: RedisClientType,
    private readonly ownsConnection: boolean,
  ) {}

  /** Build a store around an already-connected Redis client (tests / custom wiring). */
  static fromClient(redis: RedisClientType): RedisTaskStore {
    return new RedisTaskStore(redis, false)
  }

  static async connect(redisUrl: string): Promise<RedisTaskStore> {
    const redis = createClient({ url: redisUrl }) as RedisClientType
    redis.on('error', (error) => {
      process.stderr.write(
        `[mcp-air redis] ${error instanceof Error ? error.message : String(error)}\n`,
      )
    })
    await redis.connect()
    return new RedisTaskStore(redis, true)
  }

  async close(): Promise<void> {
    if (this.ownsConnection) {
      await this.redis.quit()
    }
  }

  private async readStored(taskId: string): Promise<StoredTask | null> {
    const raw = await this.redis.get(taskKey(taskId))
    if (raw === null) {
      return null
    }
    return JSON.parse(raw) as StoredTask
  }

  private async writeStored(stored: StoredTask, expireSeconds?: number): Promise<void> {
    const key = taskKey(stored.task.taskId)
    const payload = JSON.stringify(stored)
    if (expireSeconds !== undefined) {
      await this.redis.set(key, payload, { EX: expireSeconds })
    } else {
      await this.redis.set(key, payload)
    }
  }

  private async refreshIndex(taskId: string, score: number, expireSeconds?: number): Promise<void> {
    await this.redis.zAdd(MCP_AIR_REDIS_TASK_INDEX_KEY, { score, value: taskId })
    if (expireSeconds !== undefined) {
      await this.redis.expire(MCP_AIR_REDIS_TASK_INDEX_KEY, expireSeconds)
    }
  }

  async createTask(
    taskParams: CreateTaskOptions,
    requestId: RequestId,
    request: Request,
    _sessionId?: string,
  ): Promise<Task> {
    const taskId = generateTaskId()
    const existing = await this.readStored(taskId)
    if (existing !== null) {
      throw new Error(`Task with ID ${taskId} already exists`)
    }

    const actualTtl = taskParams.ttl ?? null
    const createdAt = new Date().toISOString()
    const task: Task = {
      taskId,
      status: 'working',
      ttl: actualTtl,
      createdAt,
      lastUpdatedAt: createdAt,
      pollInterval: taskParams.pollInterval ?? 1_000,
    }

    const stored: StoredTask = { task, request, requestId }
    const expireSeconds = ttlSeconds(actualTtl)
    await this.writeStored(stored, expireSeconds)
    await this.refreshIndex(taskId, Date.parse(createdAt), expireSeconds)
    return task
  }

  async getTask(taskId: string, _sessionId?: string): Promise<Task | null> {
    const stored = await this.readStored(taskId)
    return stored === null ? null : { ...stored.task }
  }

  async storeTaskResult(
    taskId: string,
    status: 'completed' | 'failed',
    result: Result,
    _sessionId?: string,
  ): Promise<void> {
    const stored = await this.readStored(taskId)
    if (stored === null) {
      throw new Error(`Task with ID ${taskId} not found`)
    }
    if (isTerminal(stored.task.status)) {
      throw new Error(
        `Cannot store result for task ${taskId} in terminal status '${stored.task.status}'. Task results can only be stored once.`,
      )
    }

    const updated: StoredTask = {
      ...stored,
      result,
      task: {
        ...stored.task,
        status,
        lastUpdatedAt: new Date().toISOString(),
      },
    }
    const expireSeconds = ttlSeconds(updated.task.ttl)
    await this.writeStored(updated, expireSeconds)
    await this.refreshIndex(taskId, Date.parse(updated.task.createdAt), expireSeconds)
  }

  async getTaskResult(taskId: string, _sessionId?: string): Promise<Result> {
    const stored = await this.readStored(taskId)
    if (stored === null) {
      throw new Error(`Task with ID ${taskId} not found`)
    }
    if (stored.result === undefined) {
      throw new Error(`Task ${taskId} has no result stored`)
    }
    return stored.result
  }

  async updateTaskStatus(
    taskId: string,
    status: Task['status'],
    statusMessage?: string,
    _sessionId?: string,
  ): Promise<void> {
    const stored = await this.readStored(taskId)
    if (stored === null) {
      throw new Error(`Task with ID ${taskId} not found`)
    }
    if (isTerminal(stored.task.status)) {
      throw new Error(
        `Cannot update task ${taskId} from terminal status '${stored.task.status}' to '${status}'. Terminal states (completed, failed, cancelled) cannot transition to other states.`,
      )
    }

    const updatedTask: Task = {
      ...stored.task,
      status,
      lastUpdatedAt: new Date().toISOString(),
      ...(statusMessage !== undefined ? { statusMessage } : {}),
    }
    const updated: StoredTask = { ...stored, task: updatedTask }
    const expireSeconds = ttlSeconds(updated.task.ttl)
    await this.writeStored(updated, expireSeconds)
    await this.refreshIndex(taskId, Date.parse(updated.task.createdAt), expireSeconds)
  }

  async listTasks(
    cursor?: string,
    _sessionId?: string,
  ): Promise<{ tasks: Task[]; nextCursor?: string }> {
    const allTaskIds = await this.redis.zRange(MCP_AIR_REDIS_TASK_INDEX_KEY, 0, -1)
    let startIndex = 0
    if (cursor !== undefined) {
      const cursorIndex = allTaskIds.indexOf(cursor)
      if (cursorIndex < 0) {
        throw new Error(`Invalid cursor: ${cursor}`)
      }
      startIndex = cursorIndex + 1
    }

    const pageTaskIds = allTaskIds.slice(startIndex, startIndex + MCP_AIR_REDIS_TASK_LIST_PAGE_SIZE)
    const tasks: Task[] = []
    for (const taskId of pageTaskIds) {
      const stored = await this.readStored(taskId)
      if (stored !== null) {
        tasks.push({ ...stored.task })
      } else {
        await this.redis.zRem(MCP_AIR_REDIS_TASK_INDEX_KEY, taskId)
      }
    }

    const nextCursor =
      startIndex + MCP_AIR_REDIS_TASK_LIST_PAGE_SIZE < allTaskIds.length
        ? pageTaskIds[pageTaskIds.length - 1]
        : undefined

    return nextCursor === undefined ? { tasks } : { tasks, nextCursor }
  }
}
