import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import { useInstallationStore } from '../stores/installationStore'
import { useProgressStore } from '../stores/progressStore'
import { useLauncherPrefs } from '../composables/useLauncherPrefs'
import { useMigrateAction } from '../composables/useMigrateAction'
import { useOverlay } from '../composables/useOverlay'
import { DEFAULT_INSTALL_NAME } from '../../../shared/defaultInstallName'
import { emitTelemetryAction, toVariantBucket } from '../lib/telemetry'
import type { FieldOption, Installation, ShowProgressOpts, Source } from '../types/ipc'
import type { ChooserLaunchOutcome } from './useChooserHandoff'
import type { FirstUseChainHooks, PanelKey } from './usePanelOverlays'

const NO_TEMPLATE_VALUE = 'none'

export interface FirstUseChainOpts {
  handleShowProgress: (opts: ShowProgressOpts) => Promise<void>
  switchPanel: (panel: PanelKey, entrypoint?: string) => Promise<void>
  dismissTakeoverDirect: () => void
  performChooserLaunch: (
    installation: Installation,
    onMissingLaunchAction?: () => void
  ) => Promise<ChooserLaunchOutcome>
  openFirstUseTakeover: (opts?: { initialStep?: 'start' | 'localBranch' }) => Promise<void>
  resetFirstUseSpinner: () => void
}

export interface FirstUseChainApi {
  hooks: FirstUseChainHooks
  chainingFirstUseToNewInstall: Ref<boolean>
  completeFirstUseAndDismiss: () => Promise<void>
  handleFirstUseComplete: () => Promise<void>
  handleFirstUseChainLocal: (payload?: {
    cameFromLocalBranch?: boolean
    express?: boolean
  }) => Promise<void>
  handleFirstUseChainMigrate: (payload?: { express?: boolean }) => Promise<void>
  handleNewInstallTakeoverClose: () => Promise<void>
  handleNewInstallBackToLocalBranch: () => Promise<void>
}

export function useFirstUseChain(opts: FirstUseChainOpts): FirstUseChainApi {
  const installationStore = useInstallationStore()
  const progressStore = useProgressStore()
  const launcherPrefs = useLauncherPrefs()
  const { confirmMigration } = useMigrateAction({ surface: 'takeover' })
  const { current: currentOverlay } = useOverlay()

  const chainingFirstUseToNewInstall = ref(false)

  const pendingFirstUseAutoLaunchId = ref<string | null>(null)

  const pendingAutoLaunchId = ref<string | null>(null)

  const pendingCameFromLocalBranch = ref(false)

  const pendingChainedLaunch = ref(false)

  const hooks: FirstUseChainHooks = {
    shouldForceTakeover: () => chainingFirstUseToNewInstall.value,
    consumeCameFromLocalBranch: () => {
      const v = pendingCameFromLocalBranch.value
      pendingCameFromLocalBranch.value = false
      return v
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
    chainingFirstUseToNewInstall.value = false
    pendingFirstUseAutoLaunchId.value = null
    await launcherPrefs.markFirstUseCompleted()
    window.api.setFirstUseMode('none')
    opts.dismissTakeoverDirect()
  }

  async function handleFirstUseComplete(): Promise<void> {
    chainingFirstUseToNewInstall.value = false
    await launcherPrefs.markFirstUseCompleted()
    window.api.setFirstUseMode('none')
    let cloud = installationStore.installations.find((i) => i.sourceCategory === 'cloud') ?? null
    if (!cloud) {
      try {
        const all = await window.api.getInstallations()
        cloud = all.find((i) => i.sourceCategory === 'cloud') ?? null
      } catch {}
    }
    if (cloud) {
      const outcome = await opts.performChooserLaunch(cloud, opts.dismissTakeoverDirect)
      if (outcome === 'focused-running') {
        opts.dismissTakeoverDirect()
      }
      return
    }
    opts.dismissTakeoverDirect()
  }

  async function handleFirstUseChainLocal(payload?: {
    cameFromLocalBranch?: boolean
    express?: boolean
  }): Promise<void> {
    chainingFirstUseToNewInstall.value = true
    pendingFirstUseAutoLaunchId.value = null
    pendingCameFromLocalBranch.value = payload?.cameFromLocalBranch === true

    window.api.setFirstUseMode('post-consent')

    if (payload?.express === true) {
      const expressOk = await runExpressInstall()
      if (expressOk) return
      chainingFirstUseToNewInstall.value = true
      pendingFirstUseAutoLaunchId.value = null
    }

    await opts.switchPanel('new-install', 'first_use')
  }

  async function runExpressInstall(): Promise<boolean> {
    emitTelemetryAction('comfy.desktop.install.express.started', {})
    try {
      const hardware = await window.api.validateHardware()
      if (!hardware.supported) {
        console.warn('[firstUseChain] express: hardware unsupported', hardware)
        emitTelemetryAction('comfy.desktop.install.express.fallback', {
          reason: 'unsupported_hardware'
        })
        return false
      }

      const [installDir, sources] = await Promise.all([
        window.api.getDefaultInstallDir().catch(() => ''),
        window.api.getSources()
      ])
      const standalone = sources.find((s: Source) => s.id === 'standalone')
      if (!standalone) {
        console.warn('[firstUseChain] express: standalone source missing', { sources })
        emitTelemetryAction('comfy.desktop.install.express.fallback', {
          reason: 'precondition_failed'
        })
        return false
      }

      const selections: Record<string, FieldOption> = {}
      for (const field of standalone.fields) {
        if (field.type === 'text') {
          if (field.defaultValue !== undefined) {
            selections[field.id] = { value: field.defaultValue, label: field.defaultValue }
          }
          continue
        }
        const options = await window.api.getFieldOptions(
          standalone.id,
          field.id,
          selections,
          field.id === 'release' ? { includeLatestStable: true } : undefined
        )
        if (!options || options.length === 0) {
          console.warn('[firstUseChain] express: no options for field', field.id)
          emitTelemetryAction('comfy.desktop.install.express.fallback', {
            reason: 'precondition_failed'
          })
          return false
        }
        const pick =
          field.id === 'bundledTemplate'
            ? (options.find((o) => o.value === NO_TEMPLATE_VALUE) ?? options[0])
            : (options.find((o) => o.recommended) ?? options[0])
        if (!pick) {
          emitTelemetryAction('comfy.desktop.install.express.fallback', {
            reason: 'precondition_failed'
          })
          return false
        }
        selections[field.id] = pick
      }

      const instData = await window.api.buildInstallation(standalone.id, selections)
      const name = await window.api.getUniqueName(DEFAULT_INSTALL_NAME)
      const installPath = installDir ?? ''

      const result = await window.api.addInstallation({
        name,
        installPath,
        ...instData,
        status: 'installing'
      })
      if (!result.ok || !result.entry) {
        console.warn('[firstUseChain] express: addInstallation failed', result)
        emitTelemetryAction('comfy.desktop.install.express.fallback', {
          reason: 'precondition_failed'
        })
        return false
      }

      const variantId = selections.variant?.data?.variantId as string | undefined
      emitTelemetryAction('comfy.desktop.install.dispatched', {
        installation_id: result.entry.id,
        source_id: standalone.id,
        variant: variantId ? toVariantBucket(variantId) : null,
        express: true,
        entrypoint: 'first_use',
        template_selected: false
      })

      await opts.handleShowProgress({
        installationId: result.entry.id,
        title: `Installing — ${result.entry.name}`,
        apiCall: () => window.api.installInstance(result.entry!.id, true),
        autoLaunchOnFinish: true,
        opKind: 'install'
      })
      window.api.setFirstUseMode('post-consent')
      return true
    } catch (err) {
      console.warn('[firstUseChain] express install failed; falling back to Configure', err)
      emitTelemetryAction('comfy.desktop.install.express.fallback', { reason: 'error' })
      chainingFirstUseToNewInstall.value = false
      pendingFirstUseAutoLaunchId.value = null
      return false
    }
  }

  async function handleNewInstallBackToLocalBranch(): Promise<void> {
    chainingFirstUseToNewInstall.value = false
    pendingFirstUseAutoLaunchId.value = null
    pendingCameFromLocalBranch.value = false
    await opts.openFirstUseTakeover({ initialStep: 'localBranch' })
    window.api.setFirstUseMode('post-consent')
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
      void handleFirstUseChainLocal()
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
    if (chainingFirstUseToNewInstall.value) {
      await launcherPrefs.markFirstUseCompleted()
      window.api.setFirstUseMode('none')
    }
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
    handleFirstUseComplete,
    handleFirstUseChainLocal,
    handleFirstUseChainMigrate,
    handleNewInstallTakeoverClose,
    handleNewInstallBackToLocalBranch
  }
}
