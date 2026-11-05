import { reactive, watch } from 'vue'
import { proto } from '../../useProto'

/**
 * Mar's one toast, top right, in a tone of Comfy's palette. Deleting,
 * moving or archiving never asks first; it happens, and the toast offers
 * it back for a few seconds. One at a time; a new one replaces the last.
 * Only for what changes on the page you stay on: going somewhere else, or
 * work the page already shows, says nothing. The shared toast() lands here
 * too while Mar's UI is on, less those messages.
 */
export type ToastTone = 'success' | 'info' | 'warning' | 'error'

export const undoToast = reactive<{
  message: string
  undo: (() => void) | null
  tone: ToastTone
  key: number
}>({
  message: '',
  undo: null,
  tone: 'info',
  key: 0
})

/** Red failed, orange take care, green finished well, blue everything else. */
export function toneOf(message: string): ToastTone {
  if (/^(couldn|could not)|failed|didn.t/i.test(message)) return 'error'
  if (/^not enough|stops working/i.test(message)) return 'warning'
  return /\b(copied|ready|exported|saved|added|created|restored|changed|complete|duplicated|renamed|invited|queued|cleared|up to date|is live|live again|logged in|is on ComfyUI|is now a|now runs on)\b/i.test(
    message
  )
    ? 'success'
    : 'info'
}

let timer: ReturnType<typeof setTimeout> | undefined

export function notify(message: string, undo?: () => void, tone = toneOf(message)): void {
  undoToast.message = message
  undoToast.undo = undo ?? null
  undoToast.tone = tone
  undoToast.key++
  clearTimeout(timer)
  timer = setTimeout(dismiss, undo ? 6000 : 2600)
}

export function dismiss(): void {
  clearTimeout(timer)
  undoToast.message = ''
  undoToast.undo = null
}

export function runUndo(): void {
  const fn = undoToast.undo
  dismiss()
  fn?.()
}

/** toast()'s stand-ins for a page, a window, a picker or work in progress. */
const ELSEWHERE =
  /(…|↗)$|\bopens\b|^(open|opening|opened|revealed|shows|pick|choose|watch|try|searching|signing|playing|learn more|release notes|all launches|add credits|update payment|create workspace|build settings|new build flow|new project|new api key|invite to)\b/i

watch(
  () => proto.toast,
  (message) => {
    if (!message || document.documentElement.dataset.marUi !== 'on') return
    proto.toast = ''
    if (!ELSEWHERE.test(message)) notify(message)
  },
  { flush: 'sync' }
)

/** "1 workflow", "3 workflows". */
export const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`
