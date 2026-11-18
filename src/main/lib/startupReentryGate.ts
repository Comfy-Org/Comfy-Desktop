export interface StartupReentryGate {
  runOrQueue(action: () => void): void
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
