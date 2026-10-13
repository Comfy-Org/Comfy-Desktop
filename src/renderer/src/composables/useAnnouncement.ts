import { onMounted, onUnmounted, ref, type Ref } from 'vue'

interface UseAnnouncementApi {
  /** True while the launch-announcement modal is mounted. */
  announcementOpen: Ref<boolean>
  /** Asks main to close the modal; it unmounts once main has hidden the panel. */
  closeAnnouncement: () => void
}

/**
 * Title-bar news bell → main forwards `onOpenAnnouncement` here, mirroring the
 * Send Feedback flow (`useSendFeedback`). Opening marks the announcement seen
 * (persisted via `comfyApiAnnouncementSeen`); the settings-changed broadcast
 * then clears the title-bar's unread dot. The modal owns its own telemetry.
 */
export function useAnnouncement(): UseAnnouncementApi {
  const announcementOpen = ref(false)
  let unsubOpen: (() => void) | null = null
  let unsubDismiss: (() => void) | null = null

  function closeAnnouncement(): void {
    if (announcementOpen.value) window.api.closePanelModal('announcement')
  }

  onMounted(() => {
    unsubOpen = window.api.onOpenAnnouncement(() => {
      void window.api.setSetting('comfyApiAnnouncementSeen', true)
      announcementOpen.value = true
    })
    unsubDismiss = window.api.onDismissPanelModal((modal) => {
      if (modal === 'announcement') announcementOpen.value = false
    })
  })

  onUnmounted(() => {
    unsubOpen?.()
    unsubDismiss?.()
  })

  return { announcementOpen, closeAnnouncement }
}
