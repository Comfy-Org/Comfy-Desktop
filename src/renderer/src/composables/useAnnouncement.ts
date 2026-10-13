import { computed, onMounted, onUnmounted, type ComputedRef } from 'vue'
import type { PanelModalState } from './usePanelModal'

interface UseAnnouncementApi {
  /** True while the launch-announcement modal is mounted. */
  announcementOpen: ComputedRef<boolean>
  /** Asks main to close the modal; it unmounts once main has hidden the panel. */
  closeAnnouncement: () => void
}

/**
 * Title-bar news bell → main forwards `onOpenAnnouncement` here, mirroring the
 * Send Feedback flow (`useSendFeedback`). Opening marks the announcement seen
 * (persisted via `comfyApiAnnouncementSeen`); the settings-changed broadcast
 * then clears the title-bar's unread dot. The modal owns its own telemetry.
 */
export function useAnnouncement(panelModal: PanelModalState): UseAnnouncementApi {
  let unsubOpen: (() => void) | null = null

  onMounted(() => {
    unsubOpen = window.api.onOpenAnnouncement(() => {
      void window.api.setSetting('comfyApiAnnouncementSeen', true)
      panelModal.open('announcement')
    })
  })

  onUnmounted(() => {
    unsubOpen?.()
  })

  return {
    announcementOpen: computed(() => panelModal.current.value === 'announcement'),
    closeAnnouncement: () => panelModal.requestClose('announcement')
  }
}
