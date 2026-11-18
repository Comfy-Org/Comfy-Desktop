import { onUnmounted, getCurrentInstance } from 'vue'

type Unsubscribe = () => void

export function useElectronApi() {
  const cleanups: Unsubscribe[] = []

  if (getCurrentInstance()) {
    onUnmounted(() => {
      for (const fn of cleanups) fn()
      cleanups.length = 0
    })
  }

  function listen<T>(
    subscribe: (callback: (data: T) => void) => Unsubscribe,
    callback: (data: T) => void
  ): Unsubscribe {
    const unsub = subscribe(callback)
    cleanups.push(unsub)
    return unsub
  }

  function cleanup(): void {
    for (const fn of cleanups) fn()
    cleanups.length = 0
  }

  return {
    api: window.api,
    listen,
    cleanup
  }
}
