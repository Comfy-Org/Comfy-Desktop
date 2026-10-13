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

  onMounted(() => {
    unsubDismiss = window.api.onDismissPanelModal((modal) => {
      if (current.value === modal) current.value = null
    })
  })

  onUnmounted(() => {
    unsubDismiss?.()
  })

  return {
    current: readonly(current),
    open: (modal) => {
      current.value = modal
    },
    requestClose: (modal) => {
      if (current.value === modal) window.api.closePanelModal(modal)
    }
  }
}
