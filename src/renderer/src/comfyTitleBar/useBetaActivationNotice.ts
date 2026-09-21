import { ref, type Ref, type ShallowRef } from 'vue'

/** The Settings row the notice's link flashes — the beta opt-in switch itself, so the
 *  "turn it off" the copy promises is the thing under the user's cursor when Settings opens. */
export const BETA_FEATURES_FIELD_ID = 'betaFeaturesEnabled'

interface BetaNoticeBridge {
  /** Show the sticky card; `leftX`/`rightX`/`bottomY` are title-bar-local px. */
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
  /** Grants are per-install, so the pending set is keyed by the host's install. A getter,
   *  not a value: a host window attaches and detaches, and the id is pushed from main after
   *  mount, so reading it once at setup would pin the dashboard's empty id. */
  installationId: () => string
  /** No install behind the window means no launch happened here to announce. */
  isInstallLess: Ref<boolean>
  /** Chrome is collapsed mid-bootstrap, so the anchor isn't rendered. */
  isFirstUseLockdown: Ref<boolean>
  /** Wait out the ProgressModal takeover so the card lands over live ComfyUI, not the loader. */
  isLoadingLockdown?: Ref<boolean>
  /** The news bell, which the card's beak points at. */
  anchorRef: Readonly<ShallowRef<HTMLElement | null>>
  /** True while another card owns the single popup (currently the pill hint). */
  isSuppressed: () => boolean
  /** Resolved copy (i18n done by the caller). */
  title: string
  body: string
  dismissLabel: string
  actionLabel: string
}

interface BetaActivationNoticeApi {
  /** Evaluate the gate and show the card once if a notice is pending. */
  maybeShow: () => Promise<void>
  /** Retire without navigating (the card's "Got it"). */
  dismiss: () => Promise<void>
  /** Retire and open Settings on the beta opt-in row (the card's action). */
  openSettings: () => Promise<void>
  /** The card was hidden by something other than this composable (the pill hint retiring
   *  takes the shared popup with it). Clears the display state WITHOUT acknowledging, so the
   *  notice replays rather than being silently spent. */
  forgetWithoutAcknowledging: () => void
  /** `true` between show and retire. Read by the title bar to know whether this composable
   *  currently owns the window's single coachmark popup. */
  isShowing: Ref<boolean>
}

/**
 * Heads-up that a Core beta feature just turned on for this install, with the way back out.
 *
 * Deliberately shaped like `useCentralPillCoachmark`: same gate inputs, same sticky card, same
 * "persist on retire, not on show" rule — a card the user never actually saw (window closed,
 * app quit) must come back rather than being silently spent.
 *
 * What differs is WHERE the once-ever state lives. The pill hint's flag is renderer-owned and
 * boolean; this one is main-owned and per-arg, because the thing being announced is a specific
 * grant and a second grant months later has to announce itself too. So `maybeShow` asks main
 * what is pending rather than checking a flag, and retirement tells main which install's
 * notice was consumed.
 *
 * Nothing here touches enrolment. Retiring the card does not leave the beta; it only stops the
 * telling. The opt-out is the Settings switch the action points at.
 */
export function useBetaActivationNotice(
  opts: UseBetaActivationNoticeOpts
): BetaActivationNoticeApi {
  const isShowing = ref(false)
  // Guards so show/retire stick before the async round-trips land. Scoped to the install the
  // card was raised for, not to the renderer: the title bar survives attach/detach without a
  // reload, so a window that has already shown one install's card must still be able to show
  // another install's.
  let shownFor: string | null = null
  let retiredFor: string | null = null

  function gatePasses(): boolean {
    return (
      !opts.isInstallLess.value &&
      !opts.isFirstUseLockdown.value &&
      !opts.isLoadingLockdown?.value &&
      !opts.isSuppressed()
    )
  }

  async function hasPendingNotice(installationId: string): Promise<boolean> {
    try {
      const pending = await window.api.getPendingBetaNotice(installationId)
      return Array.isArray(pending) && pending.length > 0
    } catch {
      // Read failed; stay silent. Unlike the pill hint's "treat as unseen", guessing wrong
      // here would announce a beta feature that may not be on at all.
      return false
    }
  }

  async function maybeShow(): Promise<void> {
    const installationId = opts.installationId()
    if (!opts.bridge || !installationId) return
    if (shownFor === installationId || retiredFor === installationId) return
    if (!gatePasses() || !opts.anchorRef.value) return
    if (!(await hasPendingNotice(installationId))) return
    // Re-check after the await; the host could have flipped state or the pill hint could have
    // claimed the popup while we were asking.
    const anchor = opts.anchorRef.value
    if (!gatePasses() || !anchor || opts.installationId() !== installationId) return

    const rect = anchor.getBoundingClientRect()
    shownFor = installationId
    isShowing.value = true
    opts.bridge.showCoachmark({
      kind: 'beta-notice',
      title: opts.title,
      body: opts.body,
      dismissLabel: opts.dismissLabel,
      actionLabel: opts.actionLabel,
      leftX: Math.round(rect.left),
      rightX: Math.round(rect.right),
      bottomY: Math.round(rect.bottom)
    })
  }

  /**
   * Retire the card that is actually on screen.
   *
   * Acknowledges `shownFor`, NOT the host's current install: the window can retarget while the
   * card floats, and acknowledging the new install would permanently consume a notice the user
   * was never shown.
   */
  async function retire(): Promise<void> {
    isShowing.value = false
    const installationId = shownFor
    if (installationId === null || retiredFor === installationId) return
    retiredFor = installationId
    opts.bridge?.hideCoachmark()
    try {
      await window.api.acknowledgeBetaNotice(installationId)
    } catch {
      // Persistence failed; the next launch re-offers the notice.
    }
  }

  function forgetWithoutAcknowledging(): void {
    isShowing.value = false
    // Clear the shown-latch too, so the same install can raise it again on its next launch.
    shownFor = null
  }

  async function openSettings(): Promise<void> {
    // Navigate first so the popup opens even if acknowledging is slow, then retire — the
    // reverse order would leave the user in Settings with the card still floating over it.
    try {
      window.api.openGlobalSettings('general', { highlightField: BETA_FEATURES_FIELD_ID })
    } catch {
      // Opening failed; still retire. Re-showing a card whose action does not work is worse
      // than losing it, and the same switch is reachable from the menu.
    }
    await retire()
  }

  return { maybeShow, dismiss: retire, openSettings, forgetWithoutAcknowledging, isShowing }
}
