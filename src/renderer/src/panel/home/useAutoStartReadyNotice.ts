import { onScopeDispose, readonly, ref } from 'vue'

export const READY_NOTICE_MS = 12_000

export function useAutoStartReadyNotice() {
  const buildId = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined

  function stopTimer(): void {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  function show(id: string | null): void {
    stopTimer()
    buildId.value = id
    if (id !== null) timer = setTimeout(() => dismiss(id), READY_NOTICE_MS)
  }

  function dismiss(id?: string): void {
    const current = buildId.value
    if (current === null || (id !== undefined && id !== current)) return
    show(null)
    void window.api.dismissAutoStartReady?.(current).catch(() => {})
  }

  let heardAChange = false
  let disposed = false
  const unsubscribe = window.api.onAutoStartReadyChanged?.(({ installationId }) => {
    heardAChange = true
    show(installationId)
  })
  void window.api
    .getAutoStartReady?.()
    .then((id) => {
      if (!disposed && !heardAChange && id !== null) show(id)
    })
    .catch(() => {})

  onScopeDispose(() => {
    disposed = true
    unsubscribe?.()
    stopTimer()
  })

  return { buildId: readonly(buildId), dismiss }
}
