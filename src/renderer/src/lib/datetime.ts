export type Translator = (key: string, params?: Record<string, unknown>) => string

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const RECENT_DAYS_LIMIT = 30

export type RelativeTime =
  { unit: 'now' } | { unit: 'minutes' | 'hours' | 'days'; count: number } | { unit: 'date' }

function startOfLocalDay(ms: number): number {
  const day = new Date(ms)
  return new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
}

function calendarDaysBetween(earlierMs: number, laterMs: number): number {
  return Math.round((startOfLocalDay(laterMs) - startOfLocalDay(earlierMs)) / DAY_MS)
}

export function relativeTime(thenMs: number, nowMs: number): RelativeTime {
  const diff = Math.max(0, nowMs - thenMs)
  if (diff < MINUTE_MS) return { unit: 'now' }
  if (diff < HOUR_MS) return { unit: 'minutes', count: Math.floor(diff / MINUTE_MS) }
  if (diff < DAY_MS) return { unit: 'hours', count: Math.floor(diff / HOUR_MS) }
  const days = calendarDaysBetween(thenMs, nowMs)
  return days < RECENT_DAYS_LIMIT ? { unit: 'days', count: days } : { unit: 'date' }
}

export function formatRelativeFromMs(ms: number, t: Translator, now = Date.now()): string {
  if (!Number.isFinite(ms)) return ''
  if (ms > now) return new Date(ms).toLocaleDateString()
  const step = relativeTime(ms, now)
  switch (step.unit) {
    case 'now':
      return t('snapshots.timeJustNow')
    case 'minutes':
      return t('snapshots.timeMinutesAgo', { count: step.count })
    case 'hours':
      return t('snapshots.timeHoursAgo', { count: step.count })
    case 'days':
      return t('snapshots.timeDaysAgo', { count: step.count })
    case 'date':
      return new Date(ms).toLocaleDateString()
    default:
      return step satisfies never
  }
}

export function formatLastUsed(
  lastUsedMs: number | undefined,
  now: number,
  t: Translator,
  locale?: string
): string {
  if (typeof lastUsedMs !== 'number' || !Number.isFinite(lastUsedMs)) {
    return t('home.buildNeverUsed')
  }
  const step = relativeTime(lastUsedMs, now)
  switch (step.unit) {
    case 'now':
      return t('home.buildUsedJustNow')
    case 'minutes':
      return t('home.buildUsedMinutesAgo', { count: step.count })
    case 'hours':
      return t('home.buildUsedHoursAgo', { count: step.count })
    case 'days':
      return step.count === 1
        ? t('home.buildUsedYesterday')
        : t('home.buildUsedDaysAgo', { count: step.count })
    case 'date': {
      const used = new Date(lastUsedMs)
      const date = used.toLocaleDateString(locale, {
        month: 'short',
        day: 'numeric',
        year: used.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric'
      })
      return t('home.buildUsedOnDate', { date })
    }
    default:
      return step satisfies never
  }
}

export function formatPlaybackTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`
}
