import { ref, type Ref, type ShallowRef } from 'vue'
import type { BetaActivationNotice } from '../types/ipc'

/** The Settings row the notice's link flashes — the beta opt-in switch itself, so the
 *  "turn it off" the copy promises is the thing under the user's cursor when Settings opens.
 *
 *  Deliberately the same target for a withdrawal card. Turning this switch off drops every
 *  grant including a `--disable-*` one, so it would restore the feature the card just said was
 *  withdrawn — but the card only offers to "manage beta features", which is exactly what this
 *  row does. Pointing a withdrawal somewhere else would mean inventing a second destination
 *  for a path that no shipped core can reach yet. */
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
  /** Copy for the card main actually resolved. A callback rather than fixed strings because
   *  the wording depends on the notice: the PostHog payload may name the feature, and a
   *  remote force-off reads the opposite way from an activation. i18n stays with the caller.
   *
   *  Being a callback also keeps the copy lazy, which is load-bearing on its own: the title
   *  bar's i18n instance starts in English and `syncLocale()` does not run until mount, so
   *  anything read during setup is an English snapshot that never updates — wrong for a
   *  non-English user, and permanently wrong for every later card in this renderer. */
  copyFor: (notice: BetaActivationNotice) => {
    title: string
    body: string
    dismissLabel: string
    actionLabel: string
  }
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
  /** The install whose card is on screen, or `null`. Also the "a card is up" flag. */
  let shownForInstall: string | null = null
  /** Identity of the card on screen (see `noticeKey`). */
  let shownKey: string | null = null
  /** The args that card displayed, carried so retirement acknowledges exactly those. */
  let shownArgs: readonly string[] = []
  /** Cards already retired in this renderer session, by that same identity.
   *
   *  Keyed on the NOTICE, not on the install or the renderer. Both of those suppress too much:
   *  the title bar outlives attach/detach, and main can legitimately queue a SECOND, different
   *  card for the same install — a later grant that only now clears its version gate, say.
   *  Keying on the args lets those through while still swallowing a repeat of a card already
   *  dealt with, which is what an acknowledgement that failed to persist would otherwise
   *  produce once per gate transition. */
  const retiredKeys = new Set<string>()
  /** True while a show attempt is between its pending-read and its decision. */
  let showInFlight = false
  /** A show attempt arrived while one was in flight. The in-flight read belongs to whatever
   *  install was current when it started, so discarding the newcomer can strand the one that
   *  replaced it — a retarget mid-read leaves the old result failing its id check and nobody
   *  asking about the new install until some unrelated gate transition. Coalesced into a
   *  single re-run instead. */
  let retryQueued = false

  /** Identity of a card: the install AND its args. Args alone would let one install's
   *  dismissal suppress an identical card on another — reachable when an acknowledgement
   *  failed to persist, since the announced list is what otherwise keeps them distinct. */
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

  /** The card main is holding for this install, or `null`.
   *
   *  Takes the id rather than re-reading it, so it cannot disagree with the one `maybeShow`
   *  captured and validated. Validates `direction` against its two literals: an unrecognised
   *  value would otherwise fall through to `copyFor`, whose `=== 'disabled'` test would then
   *  silently pick the "is on" wording for a withdrawal. */
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
      // Read failed; stay silent. Unlike the pill hint's "treat as unseen", guessing wrong
      // here would announce a beta feature that may not be on at all.
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
    // Claimed BEFORE the await: the gate watcher and the post-hint retry fire independently,
    // so two calls could otherwise both clear the guard and each raise a card.
    showInFlight = true
    try {
      await showIfPending(installationId)
    } finally {
      showInFlight = false
    }
    // Re-run once for whoever was turned away. Bounded: the flag is only set by a call that
    // was skipped, so a quiet re-run ends here.
    if (retryQueued) {
      retryQueued = false
      await maybeShow()
    }
  }

  /** The pending-read and the decision that follows it. Split out so `maybeShow` can hold an
   *  in-flight claim across the whole thing without a `try` nested in the guards. */
  async function showIfPending(installationId: string): Promise<void> {
    if (!opts.bridge) return
    const notice = await pendingNotice(installationId)
    if (!notice) return
    const key = noticeKey(installationId, notice.args)
    if (retiredKeys.has(key)) return
    // Re-check after the await; the host could have flipped state or the pill hint could have
    // claimed the popup while we were asking.
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

  /**
   * Retire the card that is actually on screen.
   *
   * Acknowledges the install it was RAISED for, not the host's current one: the window can retarget while the
   * card floats, and acknowledging the new install would permanently consume a notice the user
   * was never shown.
   */
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
    } catch {
      // Persistence failed; the next launch re-offers the notice.
    }
  }

  function forgetWithoutAcknowledging(): void {
    isShowing.value = false
    // Deliberately NOT added to `retiredKeys`: it was never acknowledged, so it must come
    // back rather than being silently spent.
    shownForInstall = null
    shownKey = null
    shownArgs = []
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
