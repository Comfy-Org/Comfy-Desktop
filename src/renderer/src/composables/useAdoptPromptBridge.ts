import { onMounted, onUnmounted } from 'vue'
import { useDialogs } from './useDialogs'
import type { AdoptPromptRequest } from '../types/ipc'

// Bridges main-process adopt prompts into the in-app dialogs (replacing native
// OS message boxes): ACKs delivery immediately, then replies with the chosen
// button index, falling back to cancel on any failure so the backend never
// blocks. Mount once per renderer entry point that can run adoption (PanelApp),
// alongside <DialogHost />. Labels arrive pre-translated from main.
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
        messageDetails: detailGroups
      })
      return req.cancelId
    }

    // None of the adopt prompts is destructive (Retry / Adopt anyway / Adopt),
    // so the primary button stays `primary` regardless of message severity.
    const result = await dialogs.confirm({
      title: req.title,
      message: req.message,
      confirmLabel: req.buttons[req.defaultId] ?? req.buttons[0],
      cancelLabel: req.buttons[req.cancelId] ?? req.buttons[req.buttons.length - 1],
      tone: 'primary',
      showCancel: true,
      messageDetails: detailGroups
    })
    return result === 'primary' ? req.defaultId : req.cancelId
  }

  // Runs after the prompt has already been ACKed. Always sends a response so
  // the backend never blocks; falls back to the cancel button on any dialog
  // error, and swallows send errors so one bad prompt can't poison the chain.
  async function respondTo(req: AdoptPromptRequest): Promise<void> {
    let buttonIndex: number
    try {
      buttonIndex = await pickButton(req)
    } catch {
      buttonIndex = req.cancelId
    }
    try {
      window.api.respondAdoptPrompt({ promptId: req.promptId, buttonIndex })
    } catch {
      // Main falls back to cancel via its ACK timeout / abort / destroyed guards.
    }
  }

  onMounted(() => {
    unsubscribe = window.api.onAdoptPrompt((req) => {
      // ACK delivery immediately — before queueing behind any in-flight prompt —
      // so the backend knows a renderer is handling it and won't time out.
      try {
        window.api.ackAdoptPrompt({ promptId: req.promptId })
      } catch {
        // If the ACK send fails, main's timeout will fall back to cancel.
      }
      chain = chain.then(
        () => respondTo(req),
        () => respondTo(req)
      )
    })
  })

  onUnmounted(() => {
    unsubscribe?.()
    unsubscribe = null
  })
}
