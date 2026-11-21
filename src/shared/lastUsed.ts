export interface UsageTimes {
  lastLaunchedAt?: number
  lastStoppedAt?: number
}

export function lastUsedAt(build: UsageTimes): number | undefined {
  const times = [build.lastLaunchedAt, build.lastStoppedAt].filter(
    (time): time is number => typeof time === 'number' && Number.isFinite(time)
  )
  return times.length > 0 ? Math.max(...times) : undefined
}
