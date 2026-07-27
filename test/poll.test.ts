import { describe, expect, it } from 'vitest'

import { MCP_AIR_POLL_BACKOFF_MULTIPLIER } from '../src/config.js'
import { isAssessmentReportReady, nextPollIntervalMs } from '../src/poll.js'

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
