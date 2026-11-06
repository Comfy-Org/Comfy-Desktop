import { onMounted, onUnmounted, ref, type Ref } from 'vue'
import { emitTelemetryAction } from '../lib/telemetry'
import { buildSupportUrl } from '../lib/supportUrl'

interface UseSendFeedbackApi {
  feedbackOpen: Ref<boolean>
  feedbackUrl: Ref<string>
  closeFeedback: () => void
}

export function useSendFeedback(): UseSendFeedbackApi {
  const appVersion = ref('')
  const feedbackOpen = ref(false)
  const feedbackUrl = ref('')
  let unsubOpenFeedback: (() => void) | null = null

  function handleOpenFeedback(source: 'titlebar' | 'menu'): void {
    emitTelemetryAction('comfy.desktop.feedback.opened', { source })
    feedbackUrl.value = buildSupportUrl(appVersion.value || undefined)
    feedbackOpen.value = true
  }

  function closeFeedback(): void {
    feedbackOpen.value = false
    void window.api.closeCurrentPanel()
  }

  onMounted(() => {
    unsubOpenFeedback = window.api.onOpenFeedback(({ source }) => {
      handleOpenFeedback(source)
    })

    void window.api
      .getAppVersion()
      .then((v) => {
        appVersion.value = v
      })
      .catch(() => {})
  })

  onUnmounted(() => {
    unsubOpenFeedback?.()
  })

  return { feedbackOpen, feedbackUrl, closeFeedback }
}
