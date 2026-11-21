export interface QuitWorkSources {
  quit: () => void
  hasActiveModelTransfers: () => boolean
  suspendActiveModelDownloadsForQuit: () => Promise<unknown>
  hasPendingStopStamps: () => boolean
  settleStopStamps: (timeoutMs: number) => Promise<unknown>
  stopStampWaitMs: number
  isUpdateInstallQuit: () => boolean
}

export function createWillQuitHandler(
  sources: QuitWorkSources
): (event: { preventDefault: () => void }) => void {
  let waiting = false
  let quittingAfterWork = false
  let stopStampDeadline = 0

  function stopStampWork(): Promise<unknown>[] {
    const remainingMs = stopStampDeadline - Date.now()
    return remainingMs > 0 && sources.hasPendingStopStamps() && !sources.isUpdateInstallQuit()
      ? [sources.settleStopStamps(remainingMs)]
      : []
  }

  function pendingWork(): Promise<unknown>[] {
    const work = stopStampWork()
    if (sources.hasActiveModelTransfers()) work.push(sources.suspendActiveModelDownloadsForQuit())
    return work
  }

  return (event) => {
    if (quittingAfterWork) {
      quittingAfterWork = false
      return
    }
    if (waiting) {
      event.preventDefault()
      return
    }
    stopStampDeadline = Date.now() + sources.stopStampWaitMs
    const work = pendingWork()
    if (work.length === 0) return
    waiting = true
    event.preventDefault()
    void Promise.allSettled(work)
      .then(() => Promise.allSettled(stopStampWork()))
      .finally(() => {
        waiting = false
        quittingAfterWork = true
        sources.quit()
      })
  }
}
