import { onUnmounted } from 'vue'
import { useListAction } from '../composables/useListAction'
import { useSessionStore } from '../stores/sessionStore'
import type { Installation, ShowProgressOpts } from '../types/ipc'
import type { PanelKey } from './usePanelOverlays'

export interface ChooserHandoffOpts {
  showProgress: (opts: ShowProgressOpts) => Promise<void>
  switchPanel: (panel: PanelKey, entrypoint?: string) => Promise<void>
  hostOwnsPerformanceTestRun: () => boolean
}

export type ChooserLaunchOutcome = 'focused-running' | 'launched' | 'missing-action'

export interface ChooserHandoffApi {
  prepareChooserHostHandoff: (
    installationId: string,
    triggersInstanceStart?: boolean
  ) => Promise<void>
  performChooserLaunch: (
    installation: Installation,
    onMissingLaunchAction?: () => void,
    opts?: { isRestart?: boolean; inPlace?: boolean }
  ) => Promise<ChooserLaunchOutcome>
  launchesInPlace: (installationId: string) => boolean
  handleChooserPick: (installation: Installation, opts?: { isRestart?: boolean }) => Promise<void>
  handleChooserShowNewInstall: () => void
  performPickerLaunch: (
    installation: Installation,
    opts?: { isRestart?: boolean }
  ) => Promise<ChooserLaunchOutcome>
}

export function useChooserHandoff(opts: ChooserHandoffOpts): ChooserHandoffApi {
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
    opts?: { isRestart?: boolean; inPlace?: boolean }
  ): Promise<ChooserLaunchOutcome> {
    if (sessionStore.isRunning(installation.id)) {
      await window.api.focusComfyWindow(installation.id)
      return 'focused-running'
    }
    const actions = await window.api.getListActions(installation.id)
    const launchAction =
      actions.find((a) => a.id === 'launch') ?? actions.find((a) => a.style === 'primary') ?? null
    if (!launchAction) {
      onMissingLaunchAction()
      return 'missing-action'
    }
    if (!opts?.inPlace) {
      await executeChooserAction(installation, launchAction, {
        isRestart: opts?.isRestart === true
      })
      return 'launched'
    }
    inPlaceLaunches.add(installation.id)
    try {
      await executeChooserAction(installation, launchAction, {
        onGuardsPassed: () => prepareChooserHostHandoff(installation.id),
        isRestart: opts?.isRestart === true
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
    launchOpts?: { isRestart?: boolean }
  ): Promise<void> {
    await performChooserLaunch(
      installation,
      () => {
        void opts.switchPanel('new-install', 'chooser_pick')
      },
      { isRestart: launchOpts?.isRestart === true }
    )
  }

  async function performPickerLaunch(
    installation: Installation,
    opts?: { isRestart?: boolean }
  ): Promise<ChooserLaunchOutcome> {
    if (sessionStore.isRunning(installation.id)) {
      await window.api.focusComfyWindow(installation.id)
      return 'focused-running'
    }
    const actions = await window.api.getListActions(installation.id)
    const launchAction =
      actions.find((a) => a.id === 'launch') ?? actions.find((a) => a.style === 'primary') ?? null
    if (!launchAction) return 'missing-action'
    await executeChooserAction(installation, launchAction, { isRestart: opts?.isRestart === true })
    return 'launched'
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
