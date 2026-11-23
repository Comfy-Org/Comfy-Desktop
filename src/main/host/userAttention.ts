export interface AttentionWindow {
  isFocused(): boolean
  isDestroyed(): boolean
  flashFrame(flag: boolean): void
  on(event: 'focus', listener: () => void): unknown
  on(event: 'blur', listener: () => void): unknown
  removeListener(event: 'focus', listener: () => void): unknown
  removeListener(event: 'blur', listener: () => void): unknown
}

export interface AttentionDock {
  bounce(type: 'informational'): number
  cancelBounce(id: number): void
}

export interface AttentionApp {
  on(event: 'did-resign-active', listener: () => void): unknown
  removeListener(event: 'did-resign-active', listener: () => void): unknown
}

export interface UserAttentionOptions {
  platform: NodeJS.Platform
  dock?: AttentionDock
  app?: AttentionApp
}

export interface UserAttention {
  setNeeded(needed: boolean): void
  dispose(): void
}

const BOUNCE_REFUSED = -1

export function createUserAttention(
  window: AttentionWindow,
  { platform, dock, app }: UserAttentionOptions
): UserAttention {
  const macDock = platform === 'darwin' ? dock : undefined
  let needed = false
  let alerted = false
  let alerting = false
  let waitingForAppToDeactivate = false
  let bounceId: number | undefined

  function stopAlert(): void {
    if (!alerting) return
    alerting = false
    window.removeListener('focus', stopAlert)
    if (bounceId !== undefined) {
      macDock?.cancelBounce(bounceId)
      bounceId = undefined
    } else if (!window.isDestroyed()) {
      window.flashFrame(false)
    }
  }

  function stopWaitingForAppToDeactivate(): void {
    if (!waitingForAppToDeactivate) return
    waitingForAppToDeactivate = false
    app?.removeListener('did-resign-active', alertOnce)
    window.removeListener('focus', acknowledgeRefusedBounce)
  }

  function acknowledgeRefusedBounce(): void {
    alerted = true
    stopWaitingForAppToDeactivate()
  }

  function bounceDock(target: AttentionDock): boolean {
    const id = target.bounce('informational')
    if (id !== BOUNCE_REFUSED) {
      bounceId = id
      return true
    }
    if (app && !waitingForAppToDeactivate) {
      waitingForAppToDeactivate = true
      app.on('did-resign-active', alertOnce)
      window.on('focus', acknowledgeRefusedBounce)
    }
    return false
  }

  function alertOnce(): void {
    if (!needed || alerted || window.isDestroyed() || window.isFocused()) return
    if (macDock) {
      if (!bounceDock(macDock)) return
    } else {
      window.flashFrame(true)
    }
    stopWaitingForAppToDeactivate()
    alerted = true
    alerting = true
    window.on('focus', stopAlert)
  }

  function endWait(): void {
    if (!needed) return
    needed = false
    window.removeListener('blur', alertOnce)
    stopWaitingForAppToDeactivate()
    stopAlert()
  }

  return {
    setNeeded(next: boolean): void {
      if (!next) {
        endWait()
        return
      }
      if (needed) return
      needed = true
      alerted = false
      window.on('blur', alertOnce)
      alertOnce()
    },
    dispose: endWait
  }
}
