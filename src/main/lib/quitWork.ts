export interface QuitWorkSources {
  quit: () => void
  hasActiveModelTransfers: () => boolean
  suspendActiveModelDownloadsForQuit: () => Promise<unknown>
  hasPendingStopStamps: () => boolean
  settleStopStamps: () => Promise<unknown>
  isUpdateInstallQuit: () => boolean
}

export function createWillQuitHandler(
  sources: QuitWorkSources
): (event: { preventDefault: () => void }) => void {
  let waiting = false
  let quittingAfterWork = false

  function stopStampWork(): Promise<unknown>[] {
    return sources.hasPendingStopStamps() && !sources.isUpdateInstallQuit()
      ? [sources.settleStopStamps()]
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
