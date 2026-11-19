import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stopThenRun } from './relaunchAfterAction'

describe('stopThenRun', () => {
  beforeEach(() => {
    ;(window as unknown as { api: unknown }).api = { stopComfyUI: vi.fn(async () => {}) }
  })

  it('skips the action when the task was cancelled while the build stopped', async () => {
    const run = vi.fn(async () => ({ ok: true }))

    await expect(
      stopThenRun(
        'studio',
        () => false,
        () => true,
        run
      )
    ).resolves.toEqual({ ok: false, cancelled: true })
    expect(run).not.toHaveBeenCalled()
  })

  it('runs the action once the build has stopped', async () => {
    const run = vi.fn(async () => ({ ok: true }))

    await expect(
      stopThenRun(
        'studio',
        () => false,
        () => false,
        run
      )
    ).resolves.toEqual({ ok: true })
    expect(run).toHaveBeenCalledOnce()
  })
})
