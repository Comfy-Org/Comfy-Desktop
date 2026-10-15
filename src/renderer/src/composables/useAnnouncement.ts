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
  // Opens seen since the last dismiss; main drops a close that a later open overtook.
  let opens = 0
  let closeRequested = false

  function closeAnnouncement(): void {
    if (!announcementOpen.value || closeRequested) return
    closeRequested = true
    window.api.closePanelModal('announcement', opens)
  }

  onMounted(() => {
    unsubOpen = window.api.onOpenAnnouncement(() => {
      void window.api.setSetting('comfyApiAnnouncementSeen', true)
      opens++
      closeRequested = false
      announcementOpen.value = true
    })
    unsubDismiss = window.api.onDismissPanelModal((modal) => {
      if (modal !== 'announcement') return
      opens = 0
      closeRequested = false
      announcementOpen.value = false
    })
  })

  onUnmounted(() => {
    unsubOpen?.()
    unsubDismiss?.()
  })

  return { announcementOpen, closeAnnouncement }
}
