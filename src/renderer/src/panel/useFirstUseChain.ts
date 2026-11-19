import { onMounted, onUnmounted, ref, shallowRef, watch, type Ref, type ShallowRef } from 'vue'
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
import { saveSetupConsent, type SetupConsent } from '../lib/setupConsent'
import type { SavedSetup, SetupPlan } from '../lib/setupPlan'
import type { InstallBuildResult, Installation, ShowProgressOpts } from '../types/ipc'
import type { ChooserLaunchOutcome } from './useChooserHandoff'
import { alertAddFailure } from '../lib/addFailureAlert'
import type { FirstUseChainHooks, PanelKey, SetupHandoff } from './usePanelOverlays'

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
  changeInstallLocation?: () => Promise<void> | void
}

export interface FirstUseChainApi {
  hooks: FirstUseChainHooks
  chainingFirstUseToNewInstall: Ref<boolean>
  setupConsent: Ref<SetupConsent | null>
  savedSetup: Readonly<ShallowRef<SavedSetup | null>>
  completeFirstUseAndDismiss: () => Promise<void>
  handleSetupInstall: (plan: SetupPlan) => Promise<void>
  handleSetupChange: (consent: SetupConsent, pickedInstallRoot?: string) => Promise<void>
  handleSetupLocationChange: (installRoot: string) => void
  handleNewInstallConsentChange: (accepted: boolean) => void
  handleFirstUseChainMigrate: (payload?: { express?: boolean }) => Promise<void>
  handleNewInstallTakeoverClose: () => Promise<void>
  handleNewInstallBackToSetup: () => Promise<void>
  handleNewInstallSaveSetup: (saved: SavedSetup) => Promise<void>
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

  const pendingSetupHandoff = ref<SetupHandoff | null>(null)

  const setupConsent = ref<SetupConsent | null>(null)

  const savedSetup = shallowRef<SavedSetup | null>(null)

  let setupConsentSaved = false

  const pendingChainedLaunch = ref(false)

  async function finishFirstUse(): Promise<void> {
    chainingFirstUseToNewInstall.value = false
    pendingFirstUseAutoLaunchId.value = null
    pendingSetupHandoff.value = null
    setupConsent.value = null
    savedSetup.value = null
    await launcherPrefs.markFirstUseCompleted()
    window.api.setFirstUseMode('none')
  }

  const hooks: FirstUseChainHooks = {
    shouldForceTakeover: () => chainingFirstUseToNewInstall.value,
    consumeSetupHandoff: () => {
      const handoff = pendingSetupHandoff.value
      pendingSetupHandoff.value = null
      return handoff
    },
    onBackgroundInstall: (showOpts) => {
      const firstUseInstall = chainingFirstUseToNewInstall.value
      if (
        firstUseInstall &&
        showOpts.autoLaunchOnFinish === true &&
        pendingAutoLaunchId.value === null
      ) {
        pendingAutoLaunchId.value = showOpts.installationId
      }
      if (firstUseInstall || !launcherPrefs.firstUseCompleted.value) {
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

  async function addPlannedInstallation(plan: SetupPlan): Promise<InstallBuildResult> {
    const build = plan.workspaceBuild
    if (build) {
      return window.api.comfybuilder.installBuild({
        buildId: build.buildId,
        ...(build.artifactId
          ? { artifactId: build.artifactId, releaseVersion: build.releaseVersion }
          : {}),
        ...(plan.name ? { name: plan.name } : {}),
        ...(plan.installRoot ? { installRoot: plan.installRoot } : {})
      })
    }
    const selections = JSON.parse(JSON.stringify(plan.selections)) as SetupPlan['selections']
    const instData = await window.api.buildInstallation(plan.sourceId, selections)
    const name = await window.api.getUniqueName(plan.name || DEFAULT_INSTALL_NAME)
    return window.api.addInstallation({
      name,
      installPath: plan.installRoot,
      ...instData,
      status: 'installing',
      ...(plan.workspaceId ? { workspaceId: plan.workspaceId } : {})
    })
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
      const result = await addPlannedInstallation(plan)
      if (!result.ok || !result.entry) {
        await alertAddFailure({
          modal,
          t,
          title: t('errors.cannotAdd'),
          failure: result,
          onChangeLocation: opts.changeInstallLocation
        })
        opts.resetFirstUseSpinner()
        return
      }
      const entry = result.entry
      const variantId = plan.selections.variant?.data?.variantId as string | undefined
      emitTelemetryAction('comfy.desktop.install.dispatched', {
        installation_id: entry.id,
        source_id: plan.workspaceBuild ? 'platform' : plan.sourceId,
        variant: variantId ? toVariantBucket(variantId) : null,
        express: savedSetup.value === null,
        entrypoint: 'first_use',
        template_selected: false
      })
      chainingFirstUseToNewInstall.value = true
      await opts.handleShowProgress({
        installationId: entry.id,
        title: `${t('newInstall.installing')} — ${entry.name}`,
        apiCall: () => window.api.installInstance(entry.id, true),
        autoLaunchOnFinish: true,
        opKind: 'install'
      })
    } catch (err) {
      console.warn('[firstUseChain] setup install failed to start', err)
      emitTelemetryAction('comfy.desktop.install.not_started', {
        entrypoint: 'first_use',
        reason: 'error'
      })
      await alertAddFailure({
        modal,
        t,
        title: t('errors.cannotAdd'),
        failure: { message: (err as Error).message }
      })
      opts.resetFirstUseSpinner()
    }
  }

  async function handleSetupChange(
    consent: SetupConsent,
    pickedInstallRoot?: string
  ): Promise<void> {
    const needsConsent = !consent.acceptedTos
    setupConsent.value = consent
    setupConsentSaved = consent.acceptedTos
    chainingFirstUseToNewInstall.value = true
    pendingFirstUseAutoLaunchId.value = null
    pendingSetupHandoff.value = {
      needsConsent,
      ...(savedSetup.value ? { restore: savedSetup.value.draft } : {}),
      ...(pickedInstallRoot ? { installRoot: pickedInstallRoot } : {})
    }
    window.api.setFirstUseMode(needsConsent ? 'consent-lockdown' : 'post-consent')
    await opts.switchPanel('new-install', 'first_use')
  }

  function handleNewInstallConsentChange(accepted: boolean): void {
    if (!chainingFirstUseToNewInstall.value) return
    window.api.setFirstUseMode(accepted ? 'post-consent' : 'consent-lockdown')
    const consent = setupConsent.value
    if (!consent) return
    setupConsent.value = { ...consent, acceptedTos: accepted }
    if (!accepted || setupConsentSaved) return
    setupConsentSaved = true
    void saveSetupConsent(consent)
  }

  async function handleNewInstallBackToSetup(): Promise<void> {
    chainingFirstUseToNewInstall.value = false
    pendingFirstUseAutoLaunchId.value = null
    pendingSetupHandoff.value = null
    await opts.openFirstUseTakeover()
  }

  function handleSetupLocationChange(installRoot: string): void {
    const saved = savedSetup.value
    if (!saved) return
    savedSetup.value = {
      plan: { ...saved.plan, installRoot },
      draft: { ...saved.draft, instPath: installRoot }
    }
  }

  async function handleNewInstallSaveSetup(saved: SavedSetup): Promise<void> {
    savedSetup.value = saved
    await handleNewInstallBackToSetup()
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
    if (chainingFirstUseToNewInstall.value && setupConsent.value?.acceptedTos === false) {
      await handleNewInstallBackToSetup()
      return
    }
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
    setupConsent,
    savedSetup,
    completeFirstUseAndDismiss,
    handleSetupInstall,
    handleSetupChange,
    handleSetupLocationChange,
    handleNewInstallConsentChange,
    handleFirstUseChainMigrate,
    handleNewInstallTakeoverClose,
    handleNewInstallBackToSetup,
    handleNewInstallSaveSetup
  }
}
