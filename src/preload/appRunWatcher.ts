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
