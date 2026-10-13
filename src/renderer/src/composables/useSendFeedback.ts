import { computed, onMounted, onUnmounted, ref, type ComputedRef, type Ref } from 'vue'
import { emitTelemetryAction } from '../lib/telemetry'
import { buildSupportUrl } from '../lib/supportUrl'
import type { PanelModalState } from './usePanelModal'

interface UseSendFeedbackApi {
  /** True while the in-app feedback modal is open. */
  feedbackOpen: ComputedRef<boolean>
  /** Typeform URL with `ver` + `platform` query params resolved at open time. */
  feedbackUrl: Ref<string>
  /** Asks main to close the modal; it closes once main has hidden the panel. */
  closeFeedback: () => void
}

/**
 * Title-bar Send Feedback button + file-menu "Send Feedback" entry
 * both forward through main to `onOpenFeedback`. Fires the
 * `comfy.desktop.feedback.opened` telemetry action with the originating
 * affordance and opens the in-app feedback modal (iframe-embedded
 * typeform — see `components/FeedbackModal.vue`) so the user never
 * leaves the desktop window.
 *
 * Caches the app version at mount so the support URL's `ver` query
 * param identifies the build without forcing the click handler to
 * await an IPC. Empty string while in flight or on failure —
 * `buildSupportUrl` treats falsy as "omit the param".
 */
export function useSendFeedback(panelModal: PanelModalState): UseSendFeedbackApi {
  const appVersion = ref('')
  const feedbackUrl = ref('')
  let unsubOpenFeedback: (() => void) | null = null

  function handleOpenFeedback(source: 'titlebar' | 'menu'): void {
    emitTelemetryAction('comfy.desktop.feedback.opened', { source })
    feedbackUrl.value = buildSupportUrl(appVersion.value || undefined)
    panelModal.open('feedback')
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

  return {
    feedbackOpen: computed(() => panelModal.current.value === 'feedback'),
    feedbackUrl,
    closeFeedback: () => panelModal.requestClose('feedback')
  }
}
