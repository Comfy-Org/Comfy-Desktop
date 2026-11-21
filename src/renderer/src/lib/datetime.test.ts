import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import zh from '@locales/zh.json'

import { formatLastUsed } from './datetime'
import { appI18nOptions } from './i18nOptions'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const NOW = new Date(2026, 10, 20, 15, 0).getTime()

const english = createI18n(appI18nOptions).global.t
const chinese = createI18n({
  ...appI18nOptions,
  locale: 'zh',
  messages: { ...appI18nOptions.messages, zh }
}).global.t

describe('formatLastUsed', () => {
  it.each([
    [0, 'Used just now'],
    [30_000, 'Used just now'],
    [MINUTE_MS, 'Used 1 min ago'],
    [5 * MINUTE_MS, 'Used 5 min ago'],
    [59 * MINUTE_MS, 'Used 59 min ago'],
    [HOUR_MS, 'Used 1h ago'],
    [2 * HOUR_MS, 'Used 2h ago'],
    [23 * HOUR_MS, 'Used 23h ago'],
    [DAY_MS, 'Used yesterday'],
    [DAY_MS + 20 * HOUR_MS, 'Used yesterday'],
    [2 * DAY_MS, 'Used 2 days ago'],
    [29 * DAY_MS, 'Used 29 days ago']
  ])('says %i ms ago as %s', (ago, label) => {
    expect(formatLastUsed(NOW - ago, NOW, english, 'en')).toBe(label)
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
