import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { evalWithRetry } from '../../e2e/support/evalRetry'

describe('evalWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('recovers from the distinct Playwright promise-collection protocol error', async () => {
    const evaluate = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        new Error('electronApplication.evaluate: Resulting promise was garbage collected.')
      )
      .mockResolvedValue('bounds snapshot')

    const result = evalWithRetry(evaluate)
    await vi.advanceTimersByTimeAsync(49)
    expect(evaluate).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)

    await expect(result).resolves.toBe('bounds snapshot')
    expect(evaluate).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('surfaces callback errors without repeating the evaluation', async () => {
    const error = new Error('E2E helpers not registered')
    const evaluate = vi.fn<() => Promise<never>>().mockRejectedValue(error)

    await expect(evalWithRetry(evaluate)).rejects.toBe(error)
    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not wait after the last permitted attempt fails', async () => {
    const error = new Error('Execution context was destroyed')
    const evaluate = vi.fn<() => Promise<never>>().mockRejectedValue(error)
    const result = evalWithRetry(evaluate).catch((err: unknown) => err)
    await vi.advanceTimersByTimeAsync(150)
    expect(evaluate).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
    expect(await result).toBe(error)
  })
})
