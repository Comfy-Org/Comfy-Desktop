import { afterEach, describe, expect, it, vi } from 'vitest'

import { createWillQuitHandler, type QuitWorkSources } from './quitWork'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setup(overrides: Partial<QuitWorkSources> = {}) {
  const sources: QuitWorkSources = {
    quit: vi.fn(),
    hasActiveModelTransfers: vi.fn(() => false),
    suspendActiveModelDownloadsForQuit: vi.fn(async () => {}),
    hasPendingStopStamps: vi.fn(() => false),
    settleStopStamps: vi.fn(async () => {}),
    stopStampWaitMs: 2_000,
    isUpdateInstallQuit: vi.fn(() => false),
    ...overrides
  }
  const onWillQuit = createWillQuitHandler(sources)
  const willQuit = () => {
    const event = { preventDefault: vi.fn() }
    onWillQuit(event)
    return event
  }
  return { sources, willQuit }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('the will-quit wait', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lets Desktop quit at once when nothing is pending', () => {
    const { sources, willQuit } = setup()

    expect(willQuit().preventDefault).not.toHaveBeenCalled()
    expect(sources.quit).not.toHaveBeenCalled()
  })

  it('holds the quit until the stop times are written, then quits', async () => {
    const write = deferred()
    const { sources, willQuit } = setup({
      hasPendingStopStamps: () => true,
      settleStopStamps: () => write.promise
    })

    expect(willQuit().preventDefault).toHaveBeenCalled()
    await settle()
    expect(sources.quit).not.toHaveBeenCalled()

    write.resolve()
    await settle()
    expect(sources.quit).toHaveBeenCalledTimes(1)
  })

  it('does not hold a quit that installs an app update for the stop times', () => {
    const { sources, willQuit } = setup({
      hasPendingStopStamps: () => true,
      isUpdateInstallQuit: () => true
    })

    expect(willQuit().preventDefault).not.toHaveBeenCalled()
    expect(sources.settleStopStamps).not.toHaveBeenCalled()
  })

  it('still holds an update-install quit for model downloads, as before', async () => {
    const { sources, willQuit } = setup({
      hasActiveModelTransfers: () => true,
      hasPendingStopStamps: () => true,
      isUpdateInstallQuit: () => true
    })

    expect(willQuit().preventDefault).toHaveBeenCalled()
    await settle()
    expect(sources.suspendActiveModelDownloadsForQuit).toHaveBeenCalledTimes(1)
    expect(sources.settleStopStamps).not.toHaveBeenCalled()
    expect(sources.quit).toHaveBeenCalledTimes(1)
  })

  it('waits for downloads and stop times together', async () => {
    const downloads = deferred()
    const { sources, willQuit } = setup({
      hasActiveModelTransfers: () => true,
      suspendActiveModelDownloadsForQuit: () => downloads.promise,
      hasPendingStopStamps: () => true
    })

    willQuit()
    await settle()
    expect(sources.settleStopStamps).toHaveBeenCalledTimes(1)
    expect(sources.quit).not.toHaveBeenCalled()

    downloads.resolve()
    await settle()
    expect(sources.quit).toHaveBeenCalledTimes(1)
  })

  it('also waits for a stop time written while it waited for downloads', async () => {
    const downloads = deferred()
    const lateWrite = deferred()
    let stampPending = false
    const { sources, willQuit } = setup({
      hasActiveModelTransfers: () => true,
      suspendActiveModelDownloadsForQuit: () => downloads.promise,
      hasPendingStopStamps: () => stampPending,
      settleStopStamps: vi.fn(() => lateWrite.promise)
    })

    willQuit()
    stampPending = true
    downloads.resolve()
    await settle()
    expect(sources.settleStopStamps).toHaveBeenCalledTimes(1)
    expect(sources.quit).not.toHaveBeenCalled()

    lateWrite.resolve()
    await settle()
    expect(sources.quit).toHaveBeenCalledTimes(1)
  })

  it('gives the late stop time only what is left of the one time limit', async () => {
    const downloads = deferred()
    let stampPending = false
    const { sources, willQuit } = setup({
      hasActiveModelTransfers: () => true,
      suspendActiveModelDownloadsForQuit: () => downloads.promise,
      hasPendingStopStamps: () => stampPending
    })
    const start = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(start)

    willQuit()
    stampPending = true
    vi.mocked(Date.now).mockReturnValue(start + 500)
    downloads.resolve()
    await settle()

    expect(sources.settleStopStamps).toHaveBeenCalledWith(1_500)
  })

  it('stops waiting at the time limit when a stop time is still not written after the first wait', async () => {
    const { sources, willQuit } = setup({ hasPendingStopStamps: () => true })
    const start = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(start)
    vi.mocked(sources.settleStopStamps).mockImplementation(async () => {
      vi.mocked(Date.now).mockReturnValue(start + 2_000)
    })

    willQuit()
    await settle()

    expect(sources.settleStopStamps).toHaveBeenCalledTimes(1)
    expect(sources.settleStopStamps).toHaveBeenCalledWith(2_000)
    expect(sources.quit).toHaveBeenCalledTimes(1)
  })

  it('does not wait for a late stop time on a quit that installs an app update', async () => {
    const downloads = deferred()
    let stampPending = false
    const { sources, willQuit } = setup({
      hasActiveModelTransfers: () => true,
      suspendActiveModelDownloadsForQuit: () => downloads.promise,
      hasPendingStopStamps: () => stampPending,
      isUpdateInstallQuit: () => true
    })

    willQuit()
    stampPending = true
    downloads.resolve()
    await settle()

    expect(sources.settleStopStamps).not.toHaveBeenCalled()
    expect(sources.quit).toHaveBeenCalledTimes(1)
  })

  it('quits even when a wait fails', async () => {
    const { sources, willQuit } = setup({
      hasPendingStopStamps: () => true,
      settleStopStamps: () => Promise.reject(new Error('disk full'))
    })

    willQuit()
    await settle()
    expect(sources.quit).toHaveBeenCalledTimes(1)
  })

  it('keeps holding a second quit that comes while it waits', async () => {
    const write = deferred()
    const { sources, willQuit } = setup({
      hasPendingStopStamps: () => true,
      settleStopStamps: vi.fn(() => write.promise)
    })

    willQuit()
    expect(willQuit().preventDefault).toHaveBeenCalled()
    expect(sources.settleStopStamps).toHaveBeenCalledTimes(1)
    write.resolve()
    await settle()
    expect(sources.quit).toHaveBeenCalledTimes(1)
  })

  it('lets its own quit through once the wait is done', async () => {
    const { willQuit } = setup({ hasPendingStopStamps: () => true })

    willQuit()
    await settle()

    expect(willQuit().preventDefault).not.toHaveBeenCalled()
  })

  it('waits again on a later quit after a quit that did not finish', async () => {
    const { sources, willQuit } = setup({ hasPendingStopStamps: () => true })

    willQuit()
    await settle()
    willQuit()
    vi.mocked(sources.settleStopStamps).mockClear()

    expect(willQuit().preventDefault).toHaveBeenCalled()
    expect(sources.settleStopStamps).toHaveBeenCalledTimes(1)
  })
})
