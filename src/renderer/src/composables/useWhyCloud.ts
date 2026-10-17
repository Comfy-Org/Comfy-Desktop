import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCloudGate } from './useCloudGate'
import { useModal } from './useModal'
import { emitTelemetryAction } from '../lib/telemetry'

/** The dashboard's "Why try Cloud" dialog: open, dismiss, or go to Cloud. */
export function useWhyCloud() {
  const { t } = useI18n()
  const modal = useModal()
  const cloudGate = useCloudGate({ immediate: false })
  const whyCloudOpen = ref(false)

  function openWhyCloud(): void {
    whyCloudOpen.value = true
    emitTelemetryAction('comfy.desktop.dashboard.why_cloud_opened', {})
  }

  function dismissWhyCloud(): void {
    whyCloudOpen.value = false
    emitTelemetryAction('comfy.desktop.dashboard.why_cloud_action', { action: 'dismiss' })
  }

  async function onWhyCloudTryCloud(): Promise<void> {
    emitTelemetryAction('comfy.desktop.dashboard.why_cloud_action', { action: 'try_cloud' })
    if (await cloudGate.openCloud()) {
      whyCloudOpen.value = false
      return
    }
    await modal.alert({
      title: t('installShowcase.cloudFailedTitle'),
      message: t('installShowcase.cloudFailedMessage')
    })
  }

  return { whyCloudOpen, openWhyCloud, dismissWhyCloud, onWhyCloudTryCloud }
}
