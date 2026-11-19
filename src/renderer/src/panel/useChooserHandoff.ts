import { onUnmounted } from 'vue'
import { useListAction } from '../composables/useListAction'
import { useSessionStore } from '../stores/sessionStore'
import type { Installation, ShowProgressOpts } from '../types/ipc'
import type { PanelKey } from './usePanelOverlays'

export interface ChooserHandoffOpts {
  showProgress: (opts: ShowProgressOpts) => Promise<void>
  switchPanel: (panel: PanelKey, entrypoint?: string) => Promise<void>
  hostOwnsPerformanceTestRun: () => boolean
  showStartingBuild: (installation: Installation) => void
}

export type ChooserLaunchOutcome =
  'focused-running' | 'already-starting' | 'launched' | 'missing-action'

interface PickerLaunchOptions {
  isRestart?: boolean
  pickerWorkspaceId?: string
}

export interface ChooserHandoffApi {
  prepareChooserHostHandoff: (
    installationId: string,
    triggersInstanceStart?: boolean
  ) => Promise<void>
  performChooserLaunch: (
    installation: Installation,
    onMissingLaunchAction?: () => void,
    opts?: PickerLaunchOptions & { inPlace?: boolean }
  ) => Promise<ChooserLaunchOutcome>
  launchesInPlace: (installationId: string) => boolean
  handleChooserPick: (installation: Installation, opts?: PickerLaunchOptions) => Promise<void>
  handleChooserShowNewInstall: () => void
  performPickerLaunch: (
    installation: Installation,
    opts?: PickerLaunchOptions
  ) => Promise<ChooserLaunchOutcome>
}

export function useChooserHandoff(opts: ChooserHandoffOpts): ChooserHandoffApi {
  const { showStartingBuild } = opts
  const sessionStore = useSessionStore()
  const { executeAction: executeChooserAction } = useListAction('chooser', {
    showProgress: opts.showProgress
  })

  let pendingPickUnsub: (() => void) | null = null
  const inPlaceLaunches = new Set<string>()

  async function prepareChooserHostHandoff(
    installationId: string,
    triggersInstanceStart = true
  ): Promise<void> {
    pendingPickUnsub?.()
    pendingPickUnsub = null
    if (opts.hostOwnsPerformanceTestRun()) return
    const claimed = await window.api.claimAttachHost(installationId)
    if (claimed) return
    await window.api.transferHostBoundsToInstall(installationId)
    if (!triggersInstanceStart) return
    pendingPickUnsub = window.api.onInstanceStarted((data) => {
      if (data.installationId !== installationId) return
      pendingPickUnsub?.()
      pendingPickUnsub = null
      void window.api.closeHostWindow()
    })
  }

  async function performChooserLaunch(
    installation: Installation,
    onMissingLaunchAction: () => void = () => {},
    opts?: PickerLaunchOptions & { inPlace?: boolean }
  ): Promise<ChooserLaunchOutcome> {
    const pickerWorkspaceId =
      installation.sourceId === 'cloud' ? opts?.pickerWorkspaceId : undefined
    if (sessionStore.isRunning(installation.id)) {
      if (pickerWorkspaceId) {
        await window.api.focusComfyWindow(installation.id, pickerWorkspaceId)
      } else {
        await window.api.focusComfyWindow(installation.id)
      }
      return 'focused-running'
    }
    if (sessionStore.isLaunching(installation.id)) {
      const focused = await window.api.focusComfyWindow(installation.id)
      if (!focused) showStartingBuild(installation)
      return 'already-starting'
    }
    const actions = await window.api.getListActions(installation.id)
    const launchAction =
      actions.find((a) => a.id === 'launch') ?? actions.find((a) => a.style === 'primary') ?? null
    if (!launchAction) {
      onMissingLaunchAction()
      return 'missing-action'
    }
    const launchHooks = {
      isRestart: opts?.isRestart === true,
      actionData: pickerWorkspaceId ? { pickerWorkspaceId } : undefined
    }
    if (!opts?.inPlace) {
      await executeChooserAction(installation, launchAction, launchHooks)
      return 'launched'
    }
    inPlaceLaunches.add(installation.id)
    try {
      await executeChooserAction(installation, launchAction, {
        ...launchHooks,
        onGuardsPassed: () => prepareChooserHostHandoff(installation.id)
      })
    } finally {
      inPlaceLaunches.delete(installation.id)
    }
    return 'launched'
  }

  function launchesInPlace(installationId: string): boolean {
    return inPlaceLaunches.has(installationId)
  }

  async function handleChooserPick(
    installation: Installation,
    launchOpts?: PickerLaunchOptions
  ): Promise<void> {
    await performChooserLaunch(
      installation,
      () => {
        void opts.switchPanel('new-install', 'chooser_pick')
      },
      launchOpts
    )
  }

  async function performPickerLaunch(
    installation: Installation,
    opts?: PickerLaunchOptions
  ): Promise<ChooserLaunchOutcome> {
    return performChooserLaunch(installation, undefined, opts)
  }

  function handleChooserShowNewInstall(): void {
    void opts.switchPanel('new-install', 'chooser')
  }

  onUnmounted(() => {
    pendingPickUnsub?.()
  })

  return {
    prepareChooserHostHandoff,
    performChooserLaunch,
    launchesInPlace,
    handleChooserPick,
    handleChooserShowNewInstall,
    performPickerLaunch
  }
}
