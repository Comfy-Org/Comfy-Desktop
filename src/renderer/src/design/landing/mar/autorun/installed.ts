import { reactive, watch } from 'vue'

export type ReturningReady = 'off' | 'on'

export const RETURNING_READY_MODES: { value: ReturningReady; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' }
]

export const RETURNING_READY_SEED = { templateId: 'image_moss_image_t2i', instId: 'local-1' }

export const returningReady = reactive<{ id: ReturningReady }>({ id: 'off' })

const keyOf = (templateId: string, instId: string): string => `${templateId}@${instId}`

export const downloaded = reactive({
  keys: [] as string[],
  ready: [] as { templateId: string; instId: string }[],
  dismissed: [] as string[]
})

export function markDownloaded(templateId: string, instId: string): void {
  const key = keyOf(templateId, instId)
  if (!downloaded.keys.includes(key)) downloaded.keys.push(key)
}

export function isDownloaded(templateId: string, instId: string): boolean {
  if (downloaded.keys.includes(keyOf(templateId, instId))) return true
  return (
    returningReady.id === 'on' &&
    RETURNING_READY_SEED.templateId === templateId &&
    RETURNING_READY_SEED.instId === instId
  )
}

export function addReady(templateId: string, instId: string): void {
  const key = keyOf(templateId, instId)
  downloaded.dismissed = downloaded.dismissed.filter((k) => k !== key)
  if (!downloaded.ready.some((r) => keyOf(r.templateId, r.instId) === key))
    downloaded.ready.unshift({ templateId, instId })
}

export function clearReady(templateId: string, instId: string): void {
  const key = keyOf(templateId, instId)
  downloaded.ready = downloaded.ready.filter((r) => keyOf(r.templateId, r.instId) !== key)
  if (!downloaded.dismissed.includes(key)) downloaded.dismissed.push(key)
}

export function readyList(): { templateId: string; instId: string }[] {
  const seeded = returningReady.id === 'on' ? [RETURNING_READY_SEED] : []
  const all = [...downloaded.ready, ...seeded]
  return all.filter(
    (r, i) =>
      !downloaded.dismissed.includes(keyOf(r.templateId, r.instId)) &&
      all.findIndex((x) => keyOf(x.templateId, x.instId) === keyOf(r.templateId, r.instId)) === i
  )
}

watch(
  () => returningReady.id,
  (on) => {
    if (on !== 'on') return
    const key = keyOf(RETURNING_READY_SEED.templateId, RETURNING_READY_SEED.instId)
    downloaded.dismissed = downloaded.dismissed.filter((k) => k !== key)
  }
)
