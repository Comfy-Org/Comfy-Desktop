import { onMounted, onUnmounted, ref, type Ref } from 'vue'

interface UseAnnouncementApi {
  /** True while the launch-announcement modal is mounted. */
  announcementOpen: Ref<boolean>
  /** Imperative dismiss for the modal's `@close` handler. */
  closeAnnouncement: () => void
}

/**
 * Title-bar news bell → main forwards `onOpenAnnouncement` here, mirroring the
 * Send Feedback flow (`useSendFeedback`). Opening marks the announcement seen
 * (persisted via `cloudNodesAnnouncementSeen`); the settings-changed broadcast
 * then clears the title-bar's unread dot. The modal owns its own telemetry.
 */
export function useAnnouncement(): UseAnnouncementApi {
  const announcementOpen = ref(false)
  let unsubOpen: (() => void) | null = null

  function closeAnnouncement(): void {
    announcementOpen.value = false
    // Main flipped activePanel to 'announcement' (overlay over comfyView) when
    // the click arrived; restore the panel so the empty overlay doesn't linger.
    void window.api.closeCurrentPanel()
  }

  onMounted(() => {
    unsubOpen = window.api.onOpenAnnouncement(() => {
      void window.api.setSetting('cloudNodesAnnouncementSeen', true)
      announcementOpen.value = true
    })
  })

  onUnmounted(() => {
    unsubOpen?.()
  })

  return { announcementOpen, closeAnnouncement }
}
