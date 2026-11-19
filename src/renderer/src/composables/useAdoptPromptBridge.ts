import { onMounted, onUnmounted } from 'vue'
import { useDialogs } from './useDialogs'
import type { AdoptPromptRequest } from '../types/ipc'

export function useAdoptPromptBridge(): void {
  const dialogs = useDialogs()
  let unsubscribe: (() => void) | null = null
  let chain = Promise.resolve()

  async function pickButton(req: AdoptPromptRequest): Promise<number> {
    const detailGroups =
      req.detail && req.detailLabel ? [{ label: req.detailLabel, items: [req.detail] }] : []

    if (req.buttons.length <= 1) {
      await dialogs.alert({
        title: req.title,
        message: req.message,
        buttonLabel: req.buttons[0],
        messageDetails: detailGroups
      })
      return req.cancelId
    }

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

  async function respondTo(req: AdoptPromptRequest): Promise<void> {
    let buttonIndex: number
    try {
      buttonIndex = await pickButton(req)
    } catch {
      buttonIndex = req.cancelId
    }
    try {
      window.api.respondAdoptPrompt({ promptId: req.promptId, buttonIndex })
    } catch {}
  }

  onMounted(() => {
    unsubscribe = window.api.onAdoptPrompt((req) => {
      try {
        window.api.ackAdoptPrompt({ promptId: req.promptId })
      } catch {}
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
