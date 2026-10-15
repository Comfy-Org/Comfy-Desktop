import { onMounted, onUnmounted, readonly, ref, type Ref } from 'vue'
import type { PanelModal } from '../../../shared/panelModal'

export interface PanelModalState {
  /** Mirrors main's `panelModal`: one title-bar modal at a time. */
  current: Readonly<Ref<PanelModal | null>>
  open: (modal: PanelModal) => void
  /** Main hides the panel, then dismisses the modal, so the canvas can't see an opaque frame. */
  requestClose: (modal: PanelModal) => void
}

export function usePanelModal(): PanelModalState {
  const current = ref<PanelModal | null>(null)
  let unsubDismiss: (() => void) | null = null
  // Opens of `current` seen since it was shown; main drops a close that a later open overtook.
  let opens = 0
  let closeRequested = false

  onMounted(() => {
    unsubDismiss = window.api.onDismissPanelModal((modal) => {
      if (current.value !== modal) return
      current.value = null
      opens = 0
      closeRequested = false
    })
  })

  onUnmounted(() => {
    unsubDismiss?.()
  })

  return {
    current: readonly(current),
    open: (modal) => {
      opens = current.value === modal ? opens + 1 : 1
      closeRequested = false
      current.value = modal
    },
    requestClose: (modal) => {
      if (current.value !== modal || closeRequested) return
      closeRequested = true
      window.api.closePanelModal(modal, opens)
    }
  }
}
