export interface AttentionWindow {
  isFocused(): boolean
  isDestroyed(): boolean
  flashFrame(flag: boolean): void
  on(event: 'focus', listener: () => void): unknown
  removeListener(event: 'focus', listener: () => void): unknown
}

export interface AttentionDock {
  bounce(type: 'informational'): number
  cancelBounce(id: number): void
}

export interface UserAttentionOptions {
  platform: NodeJS.Platform
  dock?: AttentionDock
}

export interface UserAttention {
  setNeeded(needed: boolean): void
  dispose(): void
}

export function createUserAttention(
  window: AttentionWindow,
  { platform, dock }: UserAttentionOptions
): UserAttention {
  const usesDock = platform === 'darwin' && dock !== undefined
  let needed = false
  let alerting = false
  let bounceId: number | undefined

  function stopAlert(): void {
    if (!alerting) return
    alerting = false
    window.removeListener('focus', stopAlert)
    if (bounceId !== undefined) {
      dock?.cancelBounce(bounceId)
      bounceId = undefined
    } else if (!window.isDestroyed()) {
      window.flashFrame(false)
    }
  }

  function startAlert(): void {
    if (window.isDestroyed() || window.isFocused()) return
    alerting = true
    window.on('focus', stopAlert)
    if (usesDock) bounceId = dock.bounce('informational')
    else window.flashFrame(true)
  }

  return {
    setNeeded(next: boolean): void {
      if (next === needed) return
      needed = next
      if (needed) startAlert()
      else stopAlert()
    },
    dispose(): void {
      needed = false
      stopAlert()
    }
  }
}
