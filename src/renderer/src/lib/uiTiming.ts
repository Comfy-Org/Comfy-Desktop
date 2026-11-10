export const MIN_BUSY_FEEDBACK_MS = 700

export async function withMinDuration<T>(
  task: () => Promise<T>,
  minDurationMs: number = MIN_BUSY_FEEDBACK_MS
): Promise<T> {
  const startedAt = Date.now()
  try {
    return await task()
  } finally {
    await sleepRemainder(startedAt, minDurationMs)
  }
}

export async function sleepRemainder(
  startedAt: number,
  minDurationMs: number = MIN_BUSY_FEEDBACK_MS
): Promise<void> {
  const remaining = minDurationMs - (Date.now() - startedAt)
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining))
  }
}
