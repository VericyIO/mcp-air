import { describe, expect, it, vi } from "vitest";

import { RedisTaskStore } from "../src/redis-task-store.js";

const createFakeRedis = () => {
  const data = new Map<string, string>();
  const zset = new Map<string, Array<{ score: number; value: string }>>();

  return {
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
      return "OK";
    }),
    zAdd: vi.fn(
      async (key: string, member: { score: number; value: string }) => {
        const list = zset.get(key) ?? [];
        const without = list.filter((row) => row.value !== member.value);
        without.push(member);
        without.sort((a, b) => a.score - b.score);
        zset.set(key, without);
        return 1;
      },
    ),
    zRem: vi.fn(async (key: string, member: string) => {
      const list = zset.get(key) ?? [];
      zset.set(
        key,
        list.filter((row) => row.value !== member),
      );
      return 1;
    }),
    zRange: vi.fn(async (key: string) =>
      (zset.get(key) ?? []).map((row) => row.value),
    ),
    scan: vi.fn(async () => ({
      cursor: 0,
      keys: [...data.keys()],
    })),
    expire: vi.fn(async () => 1),
    quit: vi.fn(async () => "OK"),
  };
};

describe("RedisTaskStore", () => {
  it("creates, updates, completes, and lists tasks", async () => {
    const fake = createFakeRedis();
    const store = RedisTaskStore.fromClient(fake as never);
    const sessionId = "session-a";

    const task = await store.createTask(
      { ttl: 60_000, pollInterval: 1_000 },
      1,
      {
        method: "tools/call",
        params: { name: "air_wait_for_assessment" },
      } as never,
      sessionId,
    );

    expect(task.status).toBe("working");
    expect(task.ttl).toBe(60_000);

    await store.updateTaskStatus(task.taskId, "working", "polling", sessionId);
    const mid = await store.getTask(task.taskId, sessionId);
    expect(mid?.statusMessage).toBe("polling");

    await store.storeTaskResult(
      task.taskId,
      "completed",
      {
        content: [{ type: "text", text: "done" }],
      },
      sessionId,
    );

    const result = await store.getTaskResult(task.taskId, sessionId);
    expect(result).toEqual({ content: [{ type: "text", text: "done" }] });

    const listed = await store.listTasks(undefined, sessionId);
    expect(listed.tasks.some((row) => row.taskId === task.taskId)).toBe(true);
    expect(await store.getTask(task.taskId, "session-b")).toBeNull();
    expect((await store.listTasks(undefined, "session-b")).tasks).toEqual([]);

    await store.close();
    expect(fake.quit).not.toHaveBeenCalled();
  });

  it("keeps completed result when a late status update races", async () => {
    const fake = createFakeRedis();
    const store = RedisTaskStore.fromClient(fake as never);
    const sessionId = "session-race";

    const task = await store.createTask(
      { ttl: 60_000, pollInterval: 1_000 },
      1,
      {
        method: "tools/call",
        params: { name: "air_wait_for_assessment" },
      } as never,
      sessionId,
    );

    await store.storeTaskResult(
      task.taskId,
      "completed",
      { content: [{ type: "text", text: "done" }] },
      sessionId,
    );

    await expect(
      store.updateTaskStatus(task.taskId, "working", "late", sessionId),
    ).rejects.toThrow(/terminal status/);

    const result = await store.getTaskResult(task.taskId, sessionId);
    expect(result).toEqual({ content: [{ type: "text", text: "done" }] });
    expect((await store.getTask(task.taskId, sessionId))?.status).toBe(
      "completed",
    );
  });

  it("fails orphaned working tasks on restart sweep", async () => {
    const fake = createFakeRedis();
    const store = RedisTaskStore.fromClient(fake as never);
    const sessionId = "session-orphan";

    const task = await store.createTask(
      { ttl: 60_000, pollInterval: 1_000 },
      1,
      {
        method: "tools/call",
        params: { name: "air_wait_for_assessment" },
      } as never,
      sessionId,
    );

    const failedCount = await store.failOrphanedWorkingTasks();
    expect(failedCount).toBe(1);

    const orphaned = await store.getTask(task.taskId, sessionId);
    expect(orphaned?.status).toBe("failed");
    expect(orphaned?.statusMessage).toMatch(/restart/i);

    const result = await store.getTaskResult(task.taskId, sessionId);
    expect(result.isError).toBe(true);
  });
});
