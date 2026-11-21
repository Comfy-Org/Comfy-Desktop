type Translator = (key: string, params?: Record<string, unknown>) => string

export function formatRelativeFromMs(ms: number, t: Translator): string {
  if (!Number.isFinite(ms)) return ''
  const diff = Date.now() - ms
  if (diff < 0) return new Date(ms).toLocaleDateString()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('snapshots.timeJustNow')
  if (mins < 60) return t('snapshots.timeMinutesAgo', { count: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('snapshots.timeHoursAgo', { count: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return t('snapshots.timeDaysAgo', { count: days })
  return new Date(ms).toLocaleDateString()
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const LAST_USED_DAYS_LIMIT = 30

export function formatLastUsed(
  lastUsedMs: number | undefined,
  now: number,
  t: Translator,
  locale?: string
): string {
  if (typeof lastUsedMs !== 'number' || !Number.isFinite(lastUsedMs)) {
    return t('home.buildNeverUsed')
  }
  const diff = Math.max(0, now - lastUsedMs)
  if (diff < MINUTE_MS) return t('home.buildUsedJustNow')
  if (diff < HOUR_MS) return t('home.buildUsedMinutesAgo', { count: Math.floor(diff / MINUTE_MS) })
  if (diff < DAY_MS) return t('home.buildUsedHoursAgo', { count: Math.floor(diff / HOUR_MS) })
  const days = Math.floor(diff / DAY_MS)
  if (days === 1) return t('home.buildUsedYesterday')
  if (days < LAST_USED_DAYS_LIMIT) return t('home.buildUsedDaysAgo', { count: days })
  const date = new Date(lastUsedMs).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: new Date(lastUsedMs).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric'
  })
  return t('home.buildUsedOnDate', { date })
}

export function formatPlaybackTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`
}
