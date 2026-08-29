/**
 * Startup gate for OS-driven window reentry (`second-instance`, `activate`).
 *
 * Both events can fire while startup recovery (awaited inside `ipc.register()`)
 * is still moving ComfyBuilder model trees. Opening a host window that early
 * lets the user launch an install, which calls `initializeModelDownloads()`
 * mid-recovery and can memoize a stale startup pass against transient roots.
 * Until `open()` runs, only the LATEST queued action is retained; once open,
 * actions execute immediately.
 */
export interface StartupReentryGate {
  /** Run `action` now if the gate is open, otherwise queue it (replacing any prior queued action). */
  runOrQueue(action: () => void): void
  /** Open the gate and run the most recently queued action, if any. */
  open(): void
}

export function createStartupReentryGate(): StartupReentryGate {
  let opened = false
  let pending: (() => void) | null = null

  return {
    runOrQueue(action: () => void): void {
      if (opened) {
        action()
        return
      }
      pending = action
    },
    open(): void {
      opened = true
      const queued = pending
      pending = null
      queued?.()
    }
  }
}
