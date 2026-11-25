import { inject, onScopeDispose, provide, shallowRef, watch, type InjectionKey } from 'vue'
import { useSessionStore } from '../../stores/sessionStore'
import type { Installation } from '../../types/ipc'

export type OpenWhenReady = ReturnType<typeof createOpenWhenReady>

const OPEN_WHEN_READY: InjectionKey<OpenWhenReady> = Symbol('openWhenReady')

export function provideOpenWhenReady(open: (build: Installation) => void): OpenWhenReady {
  const opensWhenReady = createOpenWhenReady(open)
  provide(OPEN_WHEN_READY, opensWhenReady)
  return opensWhenReady
}

export function useOpenWhenReady(open: (build: Installation) => void): OpenWhenReady {
  return inject(OPEN_WHEN_READY, null) ?? createOpenWhenReady(open)
}

function createOpenWhenReady(open: (build: Installation) => void) {
  const sessionStore = useSessionStore()
  const waiting = shallowRef<Installation | null>(null)

  function isStillStarting(build: Installation): boolean {
    return sessionStore.isLaunching(build.id) && !sessionStore.isRunning(build.id)
  }

  function openWhenReady(build: Installation): boolean {
    if (!isStillStarting(build)) return false
    waiting.value = build
    return true
  }

  function forget(): void {
    waiting.value = null
  }

  const stop = watch(
    () => {
      const build = waiting.value
      if (!build) return 'idle'
      if (sessionStore.isRunning(build.id)) return 'running'
      return sessionStore.isLaunching(build.id) ? 'starting' : 'stopped'
    },
    (state) => {
      const build = waiting.value
      if (!build || state === 'starting') return
      waiting.value = null
      if (state === 'running') open(build)
    }
  )
  onScopeDispose(stop)

  return { openWhenReady, forget, waiting }
}
