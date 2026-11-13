import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInstallationStore } from '../stores/installationStore'
import { useProgressStore } from '../stores/progressStore'
import { useLauncherPrefs } from '../composables/useLauncherPrefs'
import { useMigrateAction } from '../composables/useMigrateAction'
import { useModal } from '../composables/useModal'
import { useOverlay } from '../composables/useOverlay'
import { DEFAULT_INSTALL_NAME } from '../../../shared/defaultInstallName'
import { checkDiskSpaceOrWarn } from '../lib/installHelpers'
import { emitTelemetryAction, toVariantBucket } from '../lib/telemetry'
import type { SetupPlan } from '../lib/setupPlan'
import type { Installation, ShowProgressOpts } from '../types/ipc'
import type { ChooserLaunchOutcome } from './useChooserHandoff'
import type { FirstUseChainHooks, PanelKey } from './usePanelOverlays'

export interface FirstUseChainOpts {
  handleShowProgress: (opts: ShowProgressOpts) => Promise<void>
  switchPanel: (panel: PanelKey, entrypoint?: string) => Promise<void>
  dismissTakeoverDirect: () => void
  performChooserLaunch: (
    installation: Installation,
    onMissingLaunchAction?: () => void
  ) => Promise<ChooserLaunchOutcome>
  openFirstUseTakeover: () => Promise<void>
  resetFirstUseSpinner: () => void
}

export interface FirstUseChainApi {
  hooks: FirstUseChainHooks
  chainingFirstUseToNewInstall: Ref<boolean>
  completeFirstUseAndDismiss: () => Promise<void>
  handleSetupInstall: (plan: SetupPlan) => Promise<void>
  handleSetupChange: () => Promise<void>
  handleFirstUseChainMigrate: (payload?: { express?: boolean }) => Promise<void>
  handleNewInstallTakeoverClose: () => Promise<void>
  handleNewInstallBackToSetup: () => Promise<void>
}

export function useFirstUseChain(opts: FirstUseChainOpts): FirstUseChainApi {
  const { t } = useI18n()
  const installationStore = useInstallationStore()
  const progressStore = useProgressStore()
  const launcherPrefs = useLauncherPrefs()
  const modal = useModal()
  const { confirmMigration } = useMigrateAction({ surface: 'takeover' })
  const { current: currentOverlay } = useOverlay()

  const chainingFirstUseToNewInstall = ref(false)

  const pendingFirstUseAutoLaunchId = ref<string | null>(null)

  const pendingAutoLaunchId = ref<string | null>(null)

  const pendingCameFromSetup = ref(false)

  const pendingChainedLaunch = ref(false)

  async function finishFirstUse(): Promise<void> {
    chainingFirstUseToNewInstall.value = false
    pendingFirstUseAutoLaunchId.value = null
    pendingCameFromSetup.value = false
    await launcherPrefs.markFirstUseCompleted()
    window.api.setFirstUseMode('none')
  }

  const hooks: FirstUseChainHooks = {
    shouldForceTakeover: () => chainingFirstUseToNewInstall.value,
    consumeCameFromSetup: () => {
      const v = pendingCameFromSetup.value
      pendingCameFromSetup.value = false
      return v
    },
    onBackgroundInstall: () => {
      if (chainingFirstUseToNewInstall.value || !launcherPrefs.firstUseCompleted.value) {
        void finishFirstUse()
      }
    },
    onShowProgress: (showOpts) => {
      if (chainingFirstUseToNewInstall.value && pendingFirstUseAutoLaunchId.value === null) {
        pendingFirstUseAutoLaunchId.value = showOpts.installationId
        showOpts.chainSpan = 'install'
        void launcherPrefs.markFirstUseCompleted()
        return
      }
      if (showOpts.autoLaunchOnFinish === true && pendingAutoLaunchId.value === null) {
        pendingAutoLaunchId.value = showOpts.installationId
        showOpts.chainSpan = 'install'
        return
      }
      if (pendingChainedLaunch.value) {
        pendingChainedLaunch.value = false
        showOpts.chainSpan = 'launch'
      }
    }
  }

  async function completeFirstUseAndDismiss(): Promise<void> {
    await finishFirstUse()
    opts.dismissTakeoverDirect()
  }

  async function handleSetupInstall(plan: SetupPlan): Promise<void> {
    try {
      if (plan.installRoot) {
        const proceed = await checkDiskSpaceOrWarn({
          path: plan.installRoot,
          estimatedRequired: plan.requiredBytes,
          flow: 'first_use',
          confirm: modal.confirm,
          t
        })
        if (!proceed) {
          opts.resetFirstUseSpinner()
          return
        }
      }
      const selections = JSON.parse(JSON.stringify(plan.selections)) as SetupPlan['selections']
      const instData = await window.api.buildInstallation(plan.sourceId, selections)
      const name = await window.api.getUniqueName(DEFAULT_INSTALL_NAME)
      const result = await window.api.addInstallation({
        name,
        installPath: plan.installRoot,
        ...instData,
        status: 'installing'
      })
      if (!result.ok || !result.entry) {
        await modal.alert({ title: t('errors.cannotAdd'), message: result.message || '' })
        opts.resetFirstUseSpinner()
        return
      }
      const entry = result.entry
      const variantId = plan.selections.variant?.data?.variantId as string | undefined
      emitTelemetryAction('comfy.desktop.install.dispatched', {
        installation_id: entry.id,
        source_id: plan.sourceId,
        variant: variantId ? toVariantBucket(variantId) : null,
        express: true,
        entrypoint: 'first_use',
        template_selected: false
      })
      chainingFirstUseToNewInstall.value = true
      await opts.handleShowProgress({
        installationId: entry.id,
        title: `${t('newInstall.installing')} — ${entry.name}`,
        apiCall: () => window.api.installInstance(entry.id, true),
        opKind: 'install'
      })
    } catch (err) {
      console.warn('[firstUseChain] setup install failed to start', err)
      emitTelemetryAction('comfy.desktop.install.not_started', {
        entrypoint: 'first_use',
        reason: 'error'
      })
      await modal.alert({ title: t('errors.cannotAdd'), message: (err as Error).message || '' })
      opts.resetFirstUseSpinner()
    }
  }

  async function handleSetupChange(): Promise<void> {
    chainingFirstUseToNewInstall.value = true
    pendingFirstUseAutoLaunchId.value = null
    pendingCameFromSetup.value = true
    window.api.setFirstUseMode('post-consent')
    await opts.switchPanel('new-install', 'first_use')
  }

  async function handleNewInstallBackToSetup(): Promise<void> {
    chainingFirstUseToNewInstall.value = false
    pendingFirstUseAutoLaunchId.value = null
    pendingCameFromSetup.value = false
    await opts.openFirstUseTakeover()
  }

  async function handleFirstUseChainMigrate(payload?: { express?: boolean }): Promise<void> {
    let legacy = installationStore.installations.find((i) => i.sourceId === 'desktop') ?? null
    if (!legacy) {
      try {
        const all = await window.api.getInstallations()
        legacy = all.find((i) => i.sourceId === 'desktop') ?? null
      } catch {}
    }
    if (!legacy) {
      opts.resetFirstUseSpinner()
      return
    }
    const result = await confirmMigration(legacy, { express: payload?.express === true })
    if (!result) {
      opts.resetFirstUseSpinner()
      return
    }

    chainingFirstUseToNewInstall.value = true
    pendingFirstUseAutoLaunchId.value = null
    opts.dismissTakeoverDirect()
    window.api.setFirstUseMode('post-consent')
    await opts.handleShowProgress({
      installationId: legacy.id,
      title: `Migrating — ${legacy.name}`,
      apiCall: () => window.api.runAction(legacy!.id, 'migrate-to-standalone', result),
      cancellable: true
    })
  }

  async function handleNewInstallTakeoverClose(): Promise<void> {
    if (chainingFirstUseToNewInstall.value) await finishFirstUse()
    if (
      currentOverlay.value?.kind === 'takeover' &&
      currentOverlay.value.component === 'new-install'
    ) {
      opts.dismissTakeoverDirect()
    }
  }

  const stopWatch = watch(
    () => {
      const id = pendingFirstUseAutoLaunchId.value ?? pendingAutoLaunchId.value
      if (!id) return null
      const op = progressStore.operations.get(id)
      return op && op.finished ? op : null
    },
    async (op) => {
      if (!op) return
      const fromFirstUse = chainingFirstUseToNewInstall.value
      const id = pendingFirstUseAutoLaunchId.value ?? pendingAutoLaunchId.value
      chainingFirstUseToNewInstall.value = false
      pendingFirstUseAutoLaunchId.value = null
      pendingAutoLaunchId.value = null
      if (fromFirstUse) {
        window.api.setFirstUseMode('none')
      }
      if (!id) return
      if (op.cancelRequested || op.error || !op.result?.ok) return
      let inst = installationStore.installations.find((i) => i.id === id) ?? null
      if (!inst || inst.sourceId === 'desktop') {
        try {
          await installationStore.fetchInstallations()
        } catch {}
        inst =
          installationStore.installations.find(
            (i) => (i as unknown as { copiedFrom?: string }).copiedFrom === id
          ) ??
          installationStore.installations
            .filter((i) => i.sourceCategory === 'local')
            .sort(
              (a, b) =>
                Date.parse(String(b.createdAt ?? '')) - Date.parse(String(a.createdAt ?? ''))
            )[0] ??
          null
      }
      if (inst) {
        pendingChainedLaunch.value = true
        void opts.performChooserLaunch(inst).finally(() => {
          pendingChainedLaunch.value = false
        })
      }
    },
    { deep: false }
  )

  let unsubFirstUseSkip: (() => void) | null = null
  onMounted(() => {
    unsubFirstUseSkip = window.api.onFirstUseSkip(() => {
      void completeFirstUseAndDismiss()
    })
  })

  onUnmounted(() => {
    stopWatch()
    unsubFirstUseSkip?.()
  })

  return {
    hooks,
    chainingFirstUseToNewInstall,
    completeFirstUseAndDismiss,
    handleSetupInstall,
    handleSetupChange,
    handleFirstUseChainMigrate,
    handleNewInstallTakeoverClose,
    handleNewInstallBackToSetup
  }
}
