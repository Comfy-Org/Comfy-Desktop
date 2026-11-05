import { ref, type Ref, type ShallowRef } from 'vue'
import type { BetaActivationNotice } from '../types/ipc'

export const BETA_FEATURES_FIELD_ID = 'betaFeaturesEnabled'

interface BetaNoticeBridge {
  showCoachmark: (payload: {
    kind?: 'pill-hint' | 'beta-notice'
    title: string
    body: string
    dismissLabel: string
    actionLabel?: string
    leftX: number
    rightX: number
    bottomY: number
  }) => void
  hideCoachmark: () => void
}

interface UseBetaActivationNoticeOpts {
  bridge: BetaNoticeBridge | undefined
  installationId: () => string
  isInstallLess: Ref<boolean>
  isFirstUseLockdown: Ref<boolean>
  isLoadingLockdown?: Ref<boolean>
  anchorRef: Readonly<ShallowRef<HTMLElement | null>>
  isSuppressed: () => boolean
  copyFor: (notice: BetaActivationNotice) => {
    title: string
    body: string
    dismissLabel: string
    actionLabel: string
  }
}

interface BetaActivationNoticeApi {
  maybeShow: () => Promise<void>
  dismiss: () => Promise<void>
  openSettings: () => Promise<void>
  forgetWithoutAcknowledging: () => void
  isShowing: Ref<boolean>
}

export function useBetaActivationNotice(
  opts: UseBetaActivationNoticeOpts
): BetaActivationNoticeApi {
  const isShowing = ref(false)
  let shownForInstall: string | null = null
  let shownKey: string | null = null
  let shownArgs: readonly string[] = []
  const retiredKeys = new Set<string>()
  let showInFlight = false
  let retryQueued = false

  function noticeKey(installationId: string, args: readonly string[]): string {
    return JSON.stringify([installationId, args])
  }

  function gatePasses(): boolean {
    return (
      !opts.isInstallLess.value &&
      !opts.isFirstUseLockdown.value &&
      !opts.isLoadingLockdown?.value &&
      !opts.isSuppressed()
    )
  }

  async function pendingNotice(installationId: string): Promise<BetaActivationNotice | null> {
    try {
      const pending = await window.api.getPendingBetaNotice(installationId)
      if (!pending || !Array.isArray(pending.args) || pending.args.length === 0) return null
      if (pending.direction !== 'enabled' && pending.direction !== 'disabled') return null
      const description = typeof pending.description === 'string' ? pending.description : null
      return {
        args: pending.args.filter((a) => typeof a === 'string'),
        direction: pending.direction,
        description
      }
    } catch {
      return null
    }
  }

  async function maybeShow(): Promise<void> {
    const installationId = opts.installationId()
    if (!opts.bridge || !installationId) return
    if (shownForInstall !== null) return
    if (showInFlight) {
      retryQueued = true
      return
    }
    if (!gatePasses() || !opts.anchorRef.value) return
    showInFlight = true
    try {
      await showIfPending(installationId)
    } finally {
      showInFlight = false
    }
    if (retryQueued) {
      retryQueued = false
      await maybeShow()
    }
  }

  async function showIfPending(installationId: string): Promise<void> {
    if (!opts.bridge) return
    const notice = await pendingNotice(installationId)
    if (!notice) return
    const key = noticeKey(installationId, notice.args)
    if (retiredKeys.has(key)) return
    const anchor = opts.anchorRef.value
    if (!gatePasses() || !anchor || opts.installationId() !== installationId) return

    const copy = opts.copyFor(notice)
    const rect = anchor.getBoundingClientRect()
    shownForInstall = installationId
    shownKey = key
    shownArgs = notice.args
    isShowing.value = true
    opts.bridge.showCoachmark({
      kind: 'beta-notice',
      title: copy.title,
      body: copy.body,
      dismissLabel: copy.dismissLabel,
      actionLabel: copy.actionLabel,
      leftX: Math.round(rect.left),
      rightX: Math.round(rect.right),
      bottomY: Math.round(rect.bottom)
    })
  }

  async function retire(): Promise<void> {
    isShowing.value = false
    const installationId = shownForInstall
    const key = shownKey
    const args = shownArgs
    if (installationId === null || key === null) return
    retiredKeys.add(key)
    shownForInstall = null
    shownKey = null
    shownArgs = []
    opts.bridge?.hideCoachmark()
    try {
      await window.api.acknowledgeBetaNotice(installationId, [...args])
    } catch {}
  }

  function forgetWithoutAcknowledging(): void {
    isShowing.value = false
    shownForInstall = null
    shownKey = null
    shownArgs = []
  }

  async function openSettings(): Promise<void> {
    try {
      window.api.openGlobalSettings('general', { highlightField: BETA_FEATURES_FIELD_ID })
    } catch {}
    await retire()
  }

  return { maybeShow, dismiss: retire, openSettings, forgetWithoutAcknowledging, isShowing }
}
