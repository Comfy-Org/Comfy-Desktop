export interface StartupReentryGate {
  runOrQueue(action: () => void): void
  runEachWhenOpen(action: () => void): void
  open(): void
}

export function createStartupReentryGate(): StartupReentryGate {
  let opened = false
  let pending: (() => void) | null = null
  const each: (() => void)[] = []

  return {
    runOrQueue(action: () => void): void {
      if (opened) {
        action()
        return
      }
      pending = action
    },
    runEachWhenOpen(action: () => void): void {
      if (opened) {
        action()
        return
      }
      each.push(action)
    },
    open(): void {
      opened = true
      const queued = pending
      pending = null
      queued?.()
      for (const action of each.splice(0)) action()
    }
  }
}
