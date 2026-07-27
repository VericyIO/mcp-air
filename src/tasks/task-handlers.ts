import type { CreateTaskRequestHandlerExtra } from '@modelcontextprotocol/sdk/experimental/tasks/interfaces.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export type AirTaskStore = CreateTaskRequestHandlerExtra['taskStore']

export const isTaskCancelled = async (
  taskStore: AirTaskStore,
  taskId: string,
): Promise<boolean> => {
  const task = await taskStore.getTask(taskId)
  return task.status === 'cancelled'
}

export const updateTaskProgress = async (
  taskStore: AirTaskStore,
  taskId: string,
  statusMessage: string,
): Promise<boolean> => {
  if (await isTaskCancelled(taskStore, taskId)) {
    return false
  }
  await taskStore.updateTaskStatus(taskId, 'working', statusMessage)
  return true
}

export const completeAirTask = async (
  taskStore: AirTaskStore,
  taskId: string,
  result: CallToolResult,
): Promise<void> => {
  if (await isTaskCancelled(taskStore, taskId)) {
    return
  }
  await taskStore.storeTaskResult(taskId, 'completed', result)
}

export const failAirTask = async (
  taskStore: AirTaskStore,
  taskId: string,
  result: CallToolResult,
): Promise<void> => {
  if (await isTaskCancelled(taskStore, taskId)) {
    return
  }
  await taskStore.storeTaskResult(taskId, 'failed', result)
}

export const standardAirTaskHandlers = {
  getTask: async (
    _args: unknown,
    { taskId, taskStore }: { taskId: string; taskStore: AirTaskStore },
  ) => taskStore.getTask(taskId),
  getTaskResult: async (
    _args: unknown,
    { taskId, taskStore }: { taskId: string; taskStore: AirTaskStore },
  ): Promise<CallToolResult> => (await taskStore.getTaskResult(taskId)) as CallToolResult,
}
