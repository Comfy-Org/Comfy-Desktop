import { promises as fs } from 'fs'

const RENAME_LOCK_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RENAME_RETRY_TOTAL_MS = 30_000

/** Retry a rename while Windows releases process, antivirus, or indexer handles. */
export async function renameWithLockRetry(
  src: string,
  dst: string,
  signal?: AbortSignal
): Promise<void> {
  const deadline = Date.now() + RENAME_RETRY_TOTAL_MS
  for (let delay = 250; ; delay = Math.min(delay * 2, 4_000)) {
    try {
      await fs.rename(src, dst)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (!RENAME_LOCK_CODES.has(code ?? '') || Date.now() + delay > deadline) throw err
      if (signal?.aborted) throw new Error('Cancelled', { cause: err })
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}
