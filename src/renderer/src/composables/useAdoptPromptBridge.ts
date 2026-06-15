import { onMounted, onUnmounted } from 'vue'
import { useDialogs } from './useDialogs'
import type { AdoptPromptRequest } from '../types/ipc'

// Bridges main-process mid-operation prompts (e.g. Legacy Desktop adoption)
// to the in-app dialog system, replacing native OS message boxes. Mount once
// per renderer entry point that can run adoption (PanelApp), alongside
// <DialogHost />. The renderer ACKs delivery immediately, then replies with
// the chosen button index; on any failure it falls back to the cancel button
// so the backend never blocks.
//
// Labels arrive pre-translated from main, so they are rendered as-is.
export function useAdoptPromptBridge(): void {
  const dialogs = useDialogs()
  let unsubscribe: (() => void) | null = null
  // Serialize prompts so two near-simultaneous requests don't clobber the
  // single shared dialog state.
  let chain = Promise.resolve()

  async function pickButton(req: AdoptPromptRequest): Promise<number> {
    const detailGroups =
      req.detail && req.detailLabel ? [{ label: req.detailLabel, items: [req.detail] }] : []

    // One button (or none) → an acknowledgement-only alert.
    if (req.buttons.length <= 1) {
      await dialogs.alert({
        title: req.title,
        message: req.message,
        buttonLabel: req.buttons[0],
        tone: req.type === 'error' ? 'danger' : 'primary',
        messageDetails: detailGroups
      })
      return req.cancelId
    }

    const result = await dialogs.confirm({
      title: req.title,
      message: req.message,
      confirmLabel: req.buttons[req.defaultId] ?? req.buttons[0],
      cancelLabel: req.buttons[req.cancelId] ?? req.buttons[req.buttons.length - 1],
      tone: req.type === 'error' ? 'danger' : 'primary',
      showCancel: true,
      messageDetails: detailGroups
    })
    return result === 'primary' ? req.defaultId : req.cancelId
  }

  async function handle(req: AdoptPromptRequest): Promise<void> {
    window.api.ackAdoptPrompt({ promptId: req.promptId })
    let buttonIndex: number
    try {
      buttonIndex = await pickButton(req)
    } catch {
      buttonIndex = req.cancelId
    }
    window.api.respondAdoptPrompt({ promptId: req.promptId, buttonIndex })
  }

  onMounted(() => {
    unsubscribe = window.api.onAdoptPrompt((req) => {
      chain = chain.then(
        () => handle(req),
        () => handle(req)
      )
    })
  })

  onUnmounted(() => {
    unsubscribe?.()
    unsubscribe = null
  })
}
