import { describe, expect, it } from 'vitest'

import { lastUsedAt } from './lastUsed'

const HOUR_MS = 60 * 60_000

function at(hour: number, minute = 0): number {
  return new Date(2026, 10, 18, hour, minute).getTime()
}

describe('lastUsedAt', () => {
  it('takes the stop time of a build that ran for hours after it started', () => {
    expect(lastUsedAt({ lastLaunchedAt: at(9), lastStoppedAt: at(18) })).toBe(at(18))
  })

  it('takes the start time of a build that started again after its last stop', () => {
    expect(lastUsedAt({ lastLaunchedAt: at(12), lastStoppedAt: at(12) - 24 * HOUR_MS })).toBe(
      at(12)
    )
  })

  it('takes the start time when the build has no stop time yet', () => {
    expect(lastUsedAt({ lastLaunchedAt: at(12) })).toBe(at(12))
  })

  it('has no time for a build that was never opened', () => {
    expect(lastUsedAt({})).toBeUndefined()
  })

  it('counts a build that ran 09:00 to 18:00 as used after one that ran 12:00 to 12:30', () => {
    const longRun = lastUsedAt({ lastLaunchedAt: at(9), lastStoppedAt: at(18) })!
    const shortRun = lastUsedAt({ lastLaunchedAt: at(12), lastStoppedAt: at(12, 30) })!
    expect(longRun).toBeGreaterThan(shortRun)
  })
})
