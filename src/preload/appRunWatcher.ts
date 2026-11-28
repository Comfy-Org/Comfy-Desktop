export const RUN_TOAST_SELECTOR = '.cs-toasts .cs-toast'

export function watchAppRun(page: Document, report: (running: boolean) => void): () => void {
  let running = false
  const check = (): void => {
    const now = page.querySelector(RUN_TOAST_SELECTOR) !== null
    if (now === running) return
    running = now
    report(now)
  }
  const observer = new MutationObserver(check)
  observer.observe(page.documentElement, { childList: true, subtree: true })
  check()
  return () => observer.disconnect()
}

export interface RunReporter {
  watchToast(): void
  reportRun(state: unknown): void
}

export function createRunReporter(
  page: Document,
  send: (running: boolean) => void,
  sendRuns: (runs: unknown[]) => void
): RunReporter {
  let stopWatching: (() => void) | null = null
  let pageReports = false
  let pageListsRuns = false
  return {
    watchToast() {
      if (pageReports || stopWatching) return
      stopWatching = watchAppRun(page, send)
    },
    reportRun(state) {
      pageReports = true
      stopWatching?.()
      stopWatching = null
      const running = typeof state === 'object' && state !== null && 'running' in state
      send(running && state.running === true)
      const runs =
        typeof state === 'object' && state !== null && 'runs' in state && Array.isArray(state.runs)
          ? state.runs
          : null
      if (runs) pageListsRuns = true
      if (pageListsRuns) sendRuns(runs ?? [])
    }
  }
}
