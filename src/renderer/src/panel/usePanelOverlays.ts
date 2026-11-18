import { nextTick, ref, watch, type Ref } from 'vue'
import type ProgressModal from '../views/ProgressModal.vue'
import type InstallWizardModal from '../views/InstallWizardModal.vue'
import type TrackModal from '../views/TrackModal.vue'
import type LoadSnapshotModal from '../views/LoadSnapshotModal.vue'
import type QuickInstallModal from '../views/QuickInstallModal.vue'
import type FirstUseTakeover from '../views/FirstUseTakeover.vue'
import type { ChangeSetupDraft } from '../lib/setupPlan'
import { useOverlay, type FlowComponent, type Overlay } from '../composables/useOverlay'
import { keepsComfyRunningWhenWindowCloses } from '../composables/useReturnToDashboardConfirm'
import { useProgressStore } from '../stores/progressStore'
import { useInstallationStore } from '../stores/installationStore'
import { emitTelemetryAction } from '../lib/telemetry'
import { usePortConflictPrompt } from '../composables/usePortConflictPrompt'
import { stopsWithItsWindow, useConfirmStopTask } from '../composables/useBuildProgress'
import type { ActionResult, ShowProgressOpts } from '../types/ipc'
import type { FirstUseMode } from '../../../shared/firstUseMode'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'

export type PanelKey =
  | 'comfy'
  | 'comfy-lifecycle'
  | 'chooser'
  | 'performance-test'
  | 'benchmarks'
  | 'feedback'
  | 'new-install'
  | 'track'
  | 'load-snapshot'
  | 'quick-install'
  | 'progress'
  | 'announcement'

const VALID_PANELS: ReadonlySet<PanelKey> = new Set([
  'comfy',
  'comfy-lifecycle',
  'chooser',
  'performance-test',
  'benchmarks',
  'feedback',
  'new-install',
  'track',
  'load-snapshot',
  'quick-install',
  'progress',
  'announcement'
])

const FLOW_PANELS: ReadonlySet<PanelKey> = new Set([
  'new-install',
  'track',
  'load-snapshot',
  'quick-install'
])

const FLOW_TELEMETRY_NAMES: Record<FlowComponent, string> = {
  'new-install': 'new_install',
  'quick-install': 'quick_install',
  track: 'track_existing',
  'load-snapshot': 'load_snapshot'
}

export function isValidPanel(raw: string | null | undefined): raw is PanelKey {
  return !!raw && VALID_PANELS.has(raw as PanelKey)
}

export function isFlowPanel(panel: PanelKey): boolean {
  return FLOW_PANELS.has(panel)
}

export interface FirstUseChainHooks {
  shouldForceTakeover: () => boolean
  onShowProgress: (opts: ShowProgressOpts) => void
  onBackgroundInstall: (opts: ShowProgressOpts) => void
  consumeSetupHandoff: () => SetupHandoff | null
}

export interface SetupHandoff {
  needsConsent: boolean
  restore?: ChangeSetupDraft
}

export interface UsePanelOverlaysOpts {
  installationId: string
  prepareChooserHostHandoff?: (
    installationId: string,
    triggersInstanceStart?: boolean
  ) => Promise<void>
  firstUseChain?: FirstUseChainHooks
  onBackgroundInstall?: (installationId: string) => void
  onBuildCreated?: (installationId: string) => void
  launchesInPlace?: (installationId: string) => boolean
  progressRef: Ref<InstanceType<typeof ProgressModal> | null>
  newInstallRef: Ref<InstanceType<typeof InstallWizardModal> | null>
  trackRef: Ref<InstanceType<typeof TrackModal> | null>
  loadSnapshotRef: Ref<InstanceType<typeof LoadSnapshotModal> | null>
  quickInstallRef: Ref<InstanceType<typeof QuickInstallModal> | null>
  firstUseRef: Ref<InstanceType<typeof FirstUseTakeover> | null>
}

export interface UsePanelOverlaysApi {
  activePanel: Ref<PanelKey>
  initialPanel: PanelKey
  defaultBodyPanel: () => PanelKey
  currentOverlay: ReturnType<typeof useOverlay>['current']
  openOverlay: ReturnType<typeof useOverlay>['openOverlay']
  closeOverlay: ReturnType<typeof useOverlay>['closeOverlay']
  answerCloseRequest: () => Promise<{ cleared: boolean } | { defer: true }>

  handleShowProgress: (opts: ShowProgressOpts) => Promise<void>
  handleProgressClose: () => void
  openFlowTakeover: (component: FlowComponent, entrypoint: string) => Promise<void>
  openFirstUseTakeover: () => Promise<void>
  dismissTakeoverDirect: () => void
  switchPanel: (panel: PanelKey, entrypoint?: string) => Promise<void>
}

const isProgressTakeover = (o: Overlay | null | undefined): boolean =>
  o?.kind === 'takeover' && o.component === 'update'
const isFirstUseTakeover = (o: Overlay | null | undefined): boolean =>
  o?.kind === 'takeover' && o.component === 'first-use'

export function firstUseModeForOverlaySwap(
  next: Overlay | null | undefined,
  prev: Overlay | null | undefined,
  chainActive: boolean
): FirstUseMode | null {
  const nextIsProgress = isProgressTakeover(next)
  if (nextIsProgress && !isProgressTakeover(prev)) {
    return 'loading-lockdown'
  }
  if (nextIsProgress || isFirstUseTakeover(next)) return null
  const isChainHandoff = isFirstUseTakeover(prev) && next?.kind === 'takeover' && chainActive
  return isChainHandoff ? null : 'none'
}

export function usePanelOverlays(opts: UsePanelOverlaysOpts): UsePanelOverlaysApi {
  const {
    installationId,
    progressRef,
    newInstallRef,
    trackRef,
    loadSnapshotRef,
    quickInstallRef,
    firstUseRef
  } = opts
  const progressStore = useProgressStore()
  const installationStore = useInstallationStore()
  const dashboardScope = useDashboardScopeStore()
  const confirmStopTask = useConfirmStopTask()
  const {
    current: currentOverlay,
    openOverlay,
    closeOverlay: confirmAndCloseOverlay
  } = useOverlay()

  watch(
    currentOverlay,
    (next, prev) => {
      const mode = firstUseModeForOverlaySwap(
        next,
        prev,
        opts.firstUseChain?.shouldForceTakeover() === true
      )
      if (mode) window.api.setFirstUseMode(mode)
    },
    { immediate: true }
  )

  const defaultBodyPanel = (): PanelKey => (installationId ? 'comfy-lifecycle' : 'chooser')

  const params = new URLSearchParams(window.location.search)
  const initialPanel: PanelKey = ((): PanelKey => {
    const raw = params.get('panel')
    if (isValidPanel(raw)) return raw
    return defaultBodyPanel()
  })()

  const activePanel = ref<PanelKey>(
    FLOW_PANELS.has(initialPanel) ? defaultBodyPanel() : initialPanel
  )

  function startOperationOnce(
    showOpts: ShowProgressOpts,
    onSettled?: (installationId: string) => void
  ): boolean {
    const existing = progressStore.operations.get(showOpts.installationId)
    if (existing && !existing.finished) return false
    progressStore.startOperation({
      installationId: showOpts.installationId,
      title: showOpts.title,
      apiCall: showOpts.apiCall as () => Promise<ActionResult>,
      cancellable: showOpts.cancellable,
      returnTo: showOpts.returnTo,
      opKind: showOpts.opKind,
      destroysInstance: showOpts.destroysInstance,
      chainSpan: showOpts.chainSpan,
      successTerminal: showOpts.successTerminal,
      actionId: showOpts.actionId,
      onSettled
    })
    return true
  }

  function runsInBackground(showOpts: ShowProgressOpts): boolean {
    if (installationId) return false
    if (showOpts.opKind === 'install') return true
    if (showOpts.opKind === 'launch') return !opts.launchesInPlace?.(showOpts.installationId)
    return opts.firstUseChain?.shouldForceTakeover() !== true
  }

  function movesToHome(showOpts: ShowProgressOpts): showOpts is ShowProgressOpts & {
    actionId: string
  } {
    return !!installationId && showOpts.opKind !== 'launch' && !!showOpts.actionId
  }

  const resolvePortConflict = usePortConflictPrompt((relaunchOpts) =>
    handleShowProgress(relaunchOpts)
  )

  function answerConflict(id: string): void {
    if (!progressStore.operations.get(id)?.result?.portConflict) return
    resolvePortConflict(id).catch((err: unknown) => {
      console.error('[ports] the port conflict prompt failed', err)
    })
  }

  function afterBackgroundTask(id: string): void {
    const result = progressStore.operations.get(id)?.result
    if (result?.portConflict) {
      answerConflict(id)
      return
    }
    if (result?.ok && result.newInstallationId) opts.onBuildCreated?.(result.newInstallationId)
  }

  function closeProgressPanel(): void {
    if (activePanel.value !== 'progress') return
    activePanel.value = defaultBodyPanel()
    window.api.closeCurrentPanel()
  }

  function openProgressTakeover(id: string, operationName: string): Promise<boolean> {
    return openOverlay({
      kind: 'takeover',
      component: 'update',
      installationId: id,
      operationName,
      onCancel: () => progressStore.cancelOperation(id)
    })
  }

  function showsLocalStartInFlight(overlay: Overlay | null): boolean {
    if (overlay?.kind !== 'takeover' || !overlay.installationId) return false
    const op = progressStore.operations.get(overlay.installationId)
    const installation = installationStore.getById(overlay.installationId)
    return op?.opKind === 'launch' && !op.finished && installation?.sourceCategory === 'local'
  }

  async function leavesLocalStartRunning(overlay: Overlay | null): Promise<boolean> {
    return (
      showsLocalStartInFlight(overlay) &&
      (await keepsComfyRunningWhenWindowCloses()) &&
      currentOverlay.value === overlay
    )
  }

  async function closeOverlay(): Promise<boolean> {
    if (!(await leavesLocalStartRunning(currentOverlay.value))) return confirmAndCloseOverlay()
    currentOverlay.value = null
    return true
  }

  function taskStoppedByClose(): string | null {
    if (installationId) return null
    for (const [id, op] of progressStore.operations) {
      if (!op.finished && !op.cancelRequested && stopsWithItsWindow(op.opKind)) return id
    }
    return null
  }

  async function confirmStopsTasks(): Promise<boolean> {
    for (let id = taskStoppedByClose(); id; id = taskStoppedByClose()) {
      const name = installationStore.getById(id)?.name ?? progressStore.operations.get(id)!.title
      if (!(await confirmStopTask(id, name))) return false
    }
    return true
  }

  async function answerCloseRequest(): Promise<{ cleared: boolean } | { defer: true }> {
    const overlay = currentOverlay.value
    if (overlay === null) {
      if (!taskStoppedByClose()) return { defer: true }
      return { cleared: await confirmStopsTasks() }
    }
    if (await leavesLocalStartRunning(overlay)) return { defer: true }
    if (!(await confirmAndCloseOverlay())) return { cleared: false }
    return { cleared: await confirmStopsTasks() }
  }

  async function handleShowProgress(showOpts: ShowProgressOpts): Promise<void> {
    const operationName = showOpts.title.split(' — ')[0] || showOpts.title
    if (movesToHome(showOpts)) {
      const handedOff = await window.api
        .showProgressOnHome({
          installationId: showOpts.installationId,
          actionId: showOpts.actionId,
          title: showOpts.title,
          actionData: showOpts.actionData,
          cancellable: showOpts.cancellable,
          opKind: showOpts.opKind,
          relaunch: showOpts.relaunchAfter === true
        })
        .catch(() => false)
      if (handedOff) {
        closeProgressPanel()
        return
      }
    }
    if (runsInBackground(showOpts)) {
      const settled =
        showOpts.opKind === 'launch'
          ? answerConflict
          : showOpts.opKind === 'install'
            ? undefined
            : afterBackgroundTask
      startOperationOnce({ ...showOpts, chainSpan: undefined }, settled)
      closeProgressPanel()
      const keepsTakeover = showOpts.opKind !== 'launch' && showOpts.opKind !== 'install'
      if (!keepsTakeover && currentOverlay.value?.kind === 'takeover') dismissTakeoverDirect()
      if (showOpts.opKind === 'install') {
        opts.firstUseChain?.onBackgroundInstall(showOpts)
        opts.onBackgroundInstall?.(showOpts.installationId)
      }
      return
    }
    opts.firstUseChain?.onShowProgress(showOpts)
    startOperationOnce(showOpts)
    const ok = await openProgressTakeover(showOpts.installationId, operationName)
    if (!ok) return
    if (!installationId && opts.prepareChooserHostHandoff && !showOpts.destroysInstance) {
      await opts.prepareChooserHostHandoff(
        showOpts.installationId,
        !!showOpts.triggersInstanceStart
      )
    }
    await nextTick()
    progressRef.value?.showOperation(showOpts.installationId)
  }

  function handleProgressClose(): void {
    currentOverlay.value = null
    window.api.closeCurrentPanel()
  }

  async function openFlowTakeover(component: FlowComponent, entrypoint: string): Promise<void> {
    const ok = await openOverlay({ kind: 'takeover', component, cancelCopyKey: 'discard-setup' })
    if (!ok) return
    const openedOverlay = currentOverlay.value
    emitTelemetryAction('comfy.desktop.install.flow.opened', {
      flow: FLOW_TELEMETRY_NAMES[component],
      entrypoint
    })
    await nextTick()
    if (component === 'new-install') {
      const setupHandoff = opts.firstUseChain?.consumeSetupHandoff() ?? null
      await dashboardScope.initialize()
      if (currentOverlay.value !== openedOverlay) return
      await newInstallRef.value?.open({
        entrypoint,
        workspaceId: dashboardScope.selectedWorkspaceId,
        ...(setupHandoff
          ? {
              cameFromSetup: true,
              needsConsent: setupHandoff.needsConsent,
              restore: setupHandoff.restore
            }
          : {})
      })
    } else if (component === 'track') trackRef.value?.open()
    else if (component === 'load-snapshot') loadSnapshotRef.value?.open()
    else if (component === 'quick-install') await quickInstallRef.value?.open()
  }

  async function openFirstUseTakeover(): Promise<void> {
    const statePromise = window.api
      .getFirstUseState()
      .catch(() => ({ skipPick: false, hasLegacyDesktop: false }))
    const ok = await openOverlay({
      kind: 'takeover',
      component: 'first-use',
      cancelCopyKey: 'quit-setup'
    })
    if (!ok) return
    await nextTick()
    const state = await statePromise
    await firstUseRef.value?.open({
      skipPick: state.skipPick,
      hasLegacyDesktop: state.hasLegacyDesktop
    })
  }

  function dismissTakeoverDirect(): void {
    if (
      currentOverlay.value?.kind === 'takeover' &&
      currentOverlay.value.component === 'first-use'
    ) {
      window.api.setFirstUseMode('none')
    }
    const cur = currentOverlay.value
    const isFlowTakeover =
      cur?.kind === 'takeover' && (FLOW_PANELS as ReadonlySet<string>).has(cur.component)
    if (isFlowTakeover) {
      window.api.closeCurrentPanel()
    }
    currentOverlay.value = null
  }

  async function switchPanel(panel: PanelKey, entrypoint: string = 'titlebar'): Promise<void> {
    const fromView = activePanel.value
    if (FLOW_PANELS.has(panel)) {
      await openFlowTakeover(panel as FlowComponent, entrypoint)
      return
    }
    if (panel === fromView) return
    activePanel.value = panel
    emitTelemetryAction('comfy.desktop.view.opened', { view: panel, from_view: fromView })
  }

  return {
    activePanel,
    initialPanel,
    defaultBodyPanel,
    currentOverlay,
    openOverlay,
    closeOverlay,
    answerCloseRequest,
    handleShowProgress,
    handleProgressClose,
    openFlowTakeover,
    openFirstUseTakeover,
    dismissTakeoverDirect,
    switchPanel
  }
}
