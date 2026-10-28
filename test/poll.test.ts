import { describe, expect, it, vi } from 'vitest'

import { MCP_AIR_POLL_BACKOFF_MULTIPLIER } from '../src/config.js'
import { isAssessmentReportReady, nextPollIntervalMs, pollUntilAssessmentReady } from '../src/poll.js'
import { currentStageLabel } from '../src/tools/composites.js'

describe('nextPollIntervalMs', () => {
  it('applies backoff multiplier up to max', () => {
    expect(nextPollIntervalMs(3_000, 10_000)).toBe(4_500)
    expect(nextPollIntervalMs(8_000, 10_000)).toBe(10_000)
    expect(nextPollIntervalMs(10_000, 10_000)).toBe(10_000)
  })

  it('uses configured multiplier', () => {
    expect(nextPollIntervalMs(5_000, 10_000, MCP_AIR_POLL_BACKOFF_MULTIPLIER)).toBe(7_500)
  })
})

describe('isAssessmentReportReady', () => {
  it('returns true for completed status', () => {
    expect(isAssessmentReportReady({ status: 'completed' })).toBe(true)
  })

  it('returns true when reportAvailable is set', () => {
    expect(isAssessmentReportReady({ status: 'running', reportAvailable: true })).toBe(true)
  })

  it('returns false while still running', () => {
    expect(isAssessmentReportReady({ status: 'running', reportAvailable: false })).toBe(false)
  })
})

describe('pollUntilAssessmentReady', () => {
  it('stops when observe yields, before the deadline and before completion', async () => {
    const running = {
      pid: 'pasm_yield',
      status: 'running',
      reportUrl: 'https://air.thalus.ai/reports/pasm_yield',
    }
    const completed = {
      pid: 'pasm_yield',
      status: 'completed',
      reportUrl: 'https://air.thalus.ai/reports/pasm_yield',
    }
    const fetchAssessment = vi
      .fn<() => Promise<Record<string, unknown>>>()
      .mockResolvedValueOnce(running)
      .mockResolvedValue(completed)

    const outcome = await pollUntilAssessmentReady(fetchAssessment, 30_000, 1, 1, async () => 'yield')

    expect(fetchAssessment).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({ ready: false, last: running })
  })

  it('returns ready when observe continues and status becomes completed', async () => {
    const running = {
      pid: 'pasm_continue',
      status: 'running',
      reportUrl: 'https://air.thalus.ai/reports/pasm_continue',
    }
    const completed = {
      pid: 'pasm_continue',
      status: 'completed',
      reportUrl: 'https://air.thalus.ai/reports/pasm_continue',
    }
    const fetchAssessment = vi
      .fn<() => Promise<Record<string, unknown>>>()
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(completed)
    const observe = vi.fn(async () => 'continue' as const)

    const outcome = await pollUntilAssessmentReady(fetchAssessment, 30_000, 1, 1, observe)

    expect(observe).toHaveBeenNthCalledWith(1, running)
    expect(observe).toHaveBeenNthCalledWith(2, completed)
    expect(outcome).toEqual({ ready: true, value: completed })
  })
})

describe('currentStageLabel', () => {
  it('says the running step and its place in the pipeline', () => {
    expect(
      currentStageLabel([
        { stageName: 'stage_a', label: 'Reading the documents', step: 1, stepCount: 12, status: 'completed' },
        { stageName: 'stage_c', label: 'Checking each risk theme', step: 4, stepCount: 12, status: 'running' },
      ]),
    ).toBe('Step 4 of 12: Checking each risk theme')
  })

  it('says the last completed step when nothing is running', () => {
    expect(
      currentStageLabel([
        { stageName: 'stage_a', label: 'Reading the documents', step: 1, stepCount: 12, status: 'completed' },
        { stageName: 'stage_c', label: 'Checking each risk theme', step: 4, stepCount: 12, status: 'completed' },
        { stageName: 'overlay', label: 'Applying the controls', step: 8, stepCount: 12, status: 'skipped' },
      ]),
    ).toBe('Step 4 of 12: Checking each risk theme')
  })

  it('fails on a stage row without its step', () => {
    expect(() =>
      currentStageLabel([{ stageName: 'lens', label: 'EU AI Act tiering (legacy)', step: null, stepCount: 12, status: 'running' }]),
    ).toThrow('Assessment stage is missing its label or step')
  })
})
