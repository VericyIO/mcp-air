import { describe, expect, it, vi } from 'vitest'

import { RedisTaskStore } from '../src/redis-task-store.js'

const createFakeRedis = () => {
  const data = new Map<string, string>()
  const zset = new Map<string, Array<{ score: number; value: string }>>()

  return {
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      data.set(key, value)
      return 'OK'
    }),
    zAdd: vi.fn(async (key: string, member: { score: number; value: string }) => {
      const list = zset.get(key) ?? []
      const without = list.filter((row) => row.value !== member.value)
      without.push(member)
      without.sort((a, b) => a.score - b.score)
      zset.set(key, without)
      return 1
    }),
    zRem: vi.fn(async (key: string, member: string) => {
      const list = zset.get(key) ?? []
      zset.set(
        key,
        list.filter((row) => row.value !== member),
      )
      return 1
    }),
    zRange: vi.fn(async (key: string) => (zset.get(key) ?? []).map((row) => row.value)),
    expire: vi.fn(async () => 1),
    quit: vi.fn(async () => 'OK'),
  }
}

describe('RedisTaskStore', () => {
  it('creates, updates, completes, and lists tasks', async () => {
    const fake = createFakeRedis()
    const store = RedisTaskStore.fromClient(fake as never)

    const task = await store.createTask(
      { ttl: 60_000, pollInterval: 1_000 },
      1,
      { method: 'tools/call', params: { name: 'air_wait_for_assessment' } } as never,
    )

    expect(task.status).toBe('working')
    expect(task.ttl).toBe(60_000)

    await store.updateTaskStatus(task.taskId, 'working', 'polling')
    const mid = await store.getTask(task.taskId)
    expect(mid?.statusMessage).toBe('polling')

    await store.storeTaskResult(task.taskId, 'completed', {
      content: [{ type: 'text', text: 'done' }],
    })

    const result = await store.getTaskResult(task.taskId)
    expect(result).toEqual({ content: [{ type: 'text', text: 'done' }] })

    const listed = await store.listTasks()
    expect(listed.tasks.some((row) => row.taskId === task.taskId)).toBe(true)

    await store.close()
    expect(fake.quit).not.toHaveBeenCalled()
  })
})
