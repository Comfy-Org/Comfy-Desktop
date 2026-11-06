import { reactive, watch } from 'vue'
import { proto } from '../../useProto'

/**
 * Mar's one toast, top right, in a tone of Comfy's palette. Deleting,
 * moving or archiving never asks first; it happens, and the toast offers
 * it back for a few seconds. One at a time; a new one replaces the last.
 * Only for what changes on the page you stay on: going somewhere else, or
 * work the page already shows, says nothing. The shared toast() lands here
 * too while Mar's UI is on, less those messages and the prototype's own notes.
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
  return /\b(copied|ready|exported|saved|added|created|restored|changed|complete|duplicated|renamed|invited|queued|cleared|updated|up to date|is live|live again|logged in|is on ComfyUI|is now a|now runs on)\b/i.test(
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

/** Notes of the prototype itself, standing in for a page, a window or a
 *  picker it doesn't have: not part of the product, so they stay in the plain
 *  white toast (ui/Toaster.vue), never this one. */
const STAND_IN =
  /↗$|\bopens\b|\bsettings$|rename, duplicate, delete$|^(open|opening|opened|revealed|shows|showing|pick|choose|watch|try|searching|signing|playing|guide:|delete|learn more|release notes|all launches|add credits|buy credits|change plan|update payment|create workspace|new build flow|new project|new api key|add provider key|invite to|account settings|switch account|sign in$|console|instance picker|invoices|app menu|attach examples|upload logo)\b/i

/** Work the page already shows: the product says nothing. */
const SHOWN = /…$/

watch(
  () => proto.toast,
  (message) => {
    if (!message || document.documentElement.dataset.marUi !== 'on') return
    if (STAND_IN.test(message)) return
    proto.toast = ''
    if (!SHOWN.test(message)) notify(message)
  },
  { flush: 'sync' }
)

/** "1 workflow", "3 workflows". */
export const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`
