import { computed, type ComputedRef, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSessionStore } from '../stores/sessionStore'
import type { Installation } from '../types/ipc'

export interface InstallCta {
  runningInThisWindow: ComputedRef<boolean>
  runningElsewhere: ComputedRef<boolean>
  runningAnywhere: ComputedRef<boolean>
  label: ComputedRef<string>
  restartInPlace: ComputedRef<boolean>
}

export function useInstallCta(
  installation: Ref<Installation | null | undefined>,
  opts: { activeInstallationId: Ref<string | null | undefined> }
): InstallCta {
  const { t } = useI18n()
  const sessionStore = useSessionStore()

  const runningAnywhere = computed(() => {
    const inst = installation.value
    if (!inst) return false
    return sessionStore.isRunning(inst.id) || sessionStore.isLaunching(inst.id)
  })

  const runningInThisWindow = computed(() => {
    const inst = installation.value
    if (!inst || !runningAnywhere.value) return false
    const active = opts.activeInstallationId.value
    return active != null && inst.id === active
  })

  const runningElsewhere = computed(() => runningAnywhere.value && !runningInThisWindow.value)

  const label = computed(() => {
    if (runningInThisWindow.value) return t('instancePicker.restart', 'Restart')
    if (runningElsewhere.value) return t('instancePicker.switch', 'Switch')
    return t('instancePicker.open', 'Start')
  })

  return {
    runningInThisWindow,
    runningElsewhere,
    runningAnywhere,
    label,
    restartInPlace: runningInThisWindow
  }
}
