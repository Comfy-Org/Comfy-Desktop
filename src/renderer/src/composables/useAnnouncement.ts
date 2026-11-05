import { onMounted, onUnmounted, ref, type Ref } from 'vue'

interface UseAnnouncementApi {
  announcementOpen: Ref<boolean>
  closeAnnouncement: () => void
}

export function useAnnouncement(): UseAnnouncementApi {
  const announcementOpen = ref(false)
  let unsubOpen: (() => void) | null = null

  function closeAnnouncement(): void {
    announcementOpen.value = false
    void window.api.closeCurrentPanel()
  }

  onMounted(() => {
    unsubOpen = window.api.onOpenAnnouncement(() => {
      void window.api.setSetting('comfyApiAnnouncementSeen', true)
      announcementOpen.value = true
    })
  })

  onUnmounted(() => {
    unsubOpen?.()
  })

  return { announcementOpen, closeAnnouncement }
}
