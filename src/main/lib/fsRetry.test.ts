// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import { renameWithLockRetry } from './fsRetry'

function lockError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: operation not permitted, rename`), { code })
}

describe('renameWithLockRetry', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('retries transient Windows lock errors until the rename succeeds', async () => {
    const rename = vi
      .spyOn(fs.promises, 'rename')
      .mockRejectedValueOnce(lockError('EPERM'))
      .mockRejectedValueOnce(lockError('EBUSY'))
      .mockResolvedValueOnce(undefined)

    await expect(renameWithLockRetry('a', 'b')).resolves.toBeUndefined()
    expect(rename).toHaveBeenCalledTimes(3)
  })

  it('stops retrying once the signal aborts', async () => {
    const rename = vi.spyOn(fs.promises, 'rename').mockRejectedValue(lockError('EPERM'))
    const controller = new AbortController()
    controller.abort()

    await expect(renameWithLockRetry('a', 'b', controller.signal)).rejects.toThrow('Cancelled')
    expect(rename).toHaveBeenCalledTimes(1)
  })

  it('does not retry non-lock errors', async () => {
    const rename = vi
      .spyOn(fs.promises, 'rename')
      .mockRejectedValue(Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }))

    await expect(renameWithLockRetry('a', 'b')).rejects.toThrow('ENOENT')
    expect(rename).toHaveBeenCalledTimes(1)
  })

  it('gives up with the original error once the retry window is exhausted', async () => {
    vi.useFakeTimers()
    const rename = vi.spyOn(fs.promises, 'rename').mockRejectedValue(lockError('EPERM'))

    const operation = renameWithLockRetry('a', 'b')
    const rejection = expect(operation).rejects.toThrow('EPERM')
    await vi.advanceTimersByTimeAsync(31_000)
    await rejection
    expect(rename.mock.calls.length).toBeGreaterThan(3)
  })
})
