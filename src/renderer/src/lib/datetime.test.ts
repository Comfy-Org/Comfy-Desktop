import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import zh from '@locales/zh.json'

import { formatLastUsed, formatRelativeFromMs, lastUsedAt, relativeTime } from './datetime'
import { appI18nOptions } from './i18nOptions'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const NOW = new Date(2026, 10, 18, 15, 0).getTime()

const english = createI18n(appI18nOptions).global.t
const chinese = createI18n({
  ...appI18nOptions,
  locale: 'zh',
  messages: { ...appI18nOptions.messages, zh }
}).global.t

function at(day: number, hour: number, minute = 0): number {
  return new Date(2026, 10, day, hour, minute).getTime()
}

describe('relativeTime', () => {
  it.each([
    [NOW - 30_000, { unit: 'now' }],
    [NOW - 5 * MINUTE_MS, { unit: 'minutes', count: 5 }],
    [NOW - 2 * HOUR_MS, { unit: 'hours', count: 2 }],
    [NOW - 23 * HOUR_MS, { unit: 'hours', count: 23 }],
    [NOW - 40 * DAY_MS, { unit: 'date' }]
  ])('names a time %i as %o', (then, step) => {
    expect(relativeTime(then, NOW)).toEqual(step)
  })

  it('counts calendar days, not 24-hour windows, once a day has passed', () => {
    expect(relativeTime(at(16, 19), NOW), 'Monday 19:00 seen Wednesday 15:00').toEqual({
      unit: 'days',
      count: 2
    })
    expect(relativeTime(at(17, 8), NOW), 'Tuesday 08:00 seen Wednesday 15:00').toEqual({
      unit: 'days',
      count: 1
    })
    expect(relativeTime(at(17, 23, 30), at(19, 0, 30)), '25 hours over two midnights').toEqual({
      unit: 'days',
      count: 2
    })
  })
})

describe('formatLastUsed', () => {
  it.each([
    [0, 'Used just now'],
    [30_000, 'Used just now'],
    [MINUTE_MS, 'Used 1m ago'],
    [5 * MINUTE_MS, 'Used 5m ago'],
    [59 * MINUTE_MS, 'Used 59m ago'],
    [HOUR_MS, 'Used 1h ago'],
    [2 * HOUR_MS, 'Used 2h ago'],
    [23 * HOUR_MS, 'Used 23h ago'],
    [DAY_MS, 'Used yesterday'],
    [2 * DAY_MS, 'Used 2d ago'],
    [29 * DAY_MS, 'Used 29d ago']
  ])('says %i ms ago as %s', (ago, label) => {
    expect(formatLastUsed(NOW - ago, NOW, english, 'en')).toBe(label)
  })

  it('says yesterday only for the day before today', () => {
    expect(formatLastUsed(at(17, 8), NOW, english, 'en')).toBe('Used yesterday')
    expect(formatLastUsed(at(16, 19), NOW, english, 'en')).toBe('Used 2d ago')
  })

  it('names the day for a build last used more than a month ago', () => {
    expect(formatLastUsed(new Date(2026, 8, 3).getTime(), NOW, english, 'en')).toBe('Used Sep 3')
  })

  it('adds the year for a build last used in an earlier year', () => {
    expect(formatLastUsed(new Date(2025, 8, 3).getTime(), NOW, english, 'en')).toBe(
      'Used Sep 3, 2025'
    )
  })

  it('says Never used for a build that was never opened', () => {
    expect(formatLastUsed(undefined, NOW, english, 'en')).toBe('Never used')
  })

  it('says Used just now when the last-used time is a little in the future', () => {
    expect(formatLastUsed(NOW + 5 * MINUTE_MS, NOW, english, 'en')).toBe('Used just now')
  })

  it('translates the label', () => {
    expect(formatLastUsed(NOW - 2 * HOUR_MS, NOW, chinese, 'zh')).toBe('2 小时前使用')
    expect(formatLastUsed(undefined, NOW, chinese, 'zh')).toBe('从未使用')
  })
})

describe('formatRelativeFromMs', () => {
  it('uses the same short units as the build cards', () => {
    expect(formatRelativeFromMs(NOW - 5 * MINUTE_MS, english, NOW)).toBe('5m ago')
    expect(formatRelativeFromMs(NOW - 2 * HOUR_MS, english, NOW)).toBe('2h ago')
    expect(formatRelativeFromMs(at(16, 19), english, NOW)).toBe('2d ago')
  })
})

describe('lastUsedAt', () => {
  it('takes the stop time of a build that ran for hours after it started', () => {
    expect(lastUsedAt({ lastLaunchedAt: NOW - 6 * HOUR_MS, lastStoppedAt: NOW - MINUTE_MS })).toBe(
      NOW - MINUTE_MS
    )
  })

  it('takes the start time of a build that started again after its last stop', () => {
    expect(lastUsedAt({ lastLaunchedAt: NOW - HOUR_MS, lastStoppedAt: NOW - DAY_MS })).toBe(
      NOW - HOUR_MS
    )
  })

  it('takes the start time when the build has no stop time yet', () => {
    expect(lastUsedAt({ lastLaunchedAt: NOW - HOUR_MS })).toBe(NOW - HOUR_MS)
  })

  it('has no time for a build that was never opened', () => {
    expect(lastUsedAt({})).toBeUndefined()
  })
})
