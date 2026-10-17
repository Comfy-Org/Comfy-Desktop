import { afterEach, describe, expect, it, vi } from 'vitest'
import { stopAndWaitForExit } from './stopWarning'

describe('stopAndWaitForExit', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects when the instance is still running after the stop timeout', async () => {
    vi.useFakeTimers()
    const stopComfyUI = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { api: { stopComfyUI: typeof stopComfyUI } }).api = { stopComfyUI }

    const stopping = stopAndWaitForExit('instance-id', () => true)
    const rejection = expect(stopping).rejects.toThrow('Timed out waiting for ComfyUI to stop.')
    await vi.advanceTimersByTimeAsync(10_000)

    await rejection
    expect(stopComfyUI).toHaveBeenCalledWith('instance-id')
  })

  it('resolves once the instance is confirmed stopped', async () => {
    const stopComfyUI = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { api: { stopComfyUI: typeof stopComfyUI } }).api = { stopComfyUI }

    await expect(stopAndWaitForExit('instance-id', () => false)).resolves.toBeUndefined()
    expect(stopComfyUI).toHaveBeenCalledWith('instance-id')
  })
})
