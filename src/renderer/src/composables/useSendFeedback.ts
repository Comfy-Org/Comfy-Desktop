import { onMounted, onUnmounted, ref, type Ref } from 'vue'
import { emitTelemetryAction } from '../lib/telemetry'
import { buildFeedbackHiddenFields } from '../lib/feedback'

interface UseSendFeedbackApi {
  feedbackOpen: Ref<boolean>
  feedbackHiddenFields: Ref<Record<string, string>>
  closeFeedback: () => void
}

export function useSendFeedback(): UseSendFeedbackApi {
  const appVersion = ref('')
  const feedbackOpen = ref(false)
  const feedbackHiddenFields = ref<Record<string, string>>({})
  let unsubOpenFeedback: (() => void) | null = null

  function handleOpenFeedback(source: 'titlebar' | 'menu'): void {
    emitTelemetryAction('comfy.desktop.feedback.opened', { source })
    feedbackHiddenFields.value = buildFeedbackHiddenFields(appVersion.value || undefined)
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

  return { feedbackOpen, feedbackHiddenFields, closeFeedback }
}
