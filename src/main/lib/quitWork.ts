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

  function pendingWork(): Promise<unknown>[] {
    const work: Promise<unknown>[] = []
    if (sources.hasActiveModelTransfers()) work.push(sources.suspendActiveModelDownloadsForQuit())
    if (sources.hasPendingStopStamps() && !sources.isUpdateInstallQuit()) {
      work.push(sources.settleStopStamps())
    }
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
    void Promise.allSettled(work).finally(() => {
      waiting = false
      quittingAfterWork = true
      sources.quit()
    })
  }
}
