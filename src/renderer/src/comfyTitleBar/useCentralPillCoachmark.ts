import { ref, type Ref, type ShallowRef } from 'vue'

/** Persisted one-time flag set when the coachmark is first dismissed. */
export const CENTRAL_PILL_HINT_SEEN_KEY = 'hasSeenCentralPillHint'

interface CoachmarkBridge {
  /** Show the coachmark popup; `leftX`/`rightX`/`bottomY` are title-bar-local px. */
  showCoachmark: (payload: {
    title: string
    body: string
    dismissLabel: string
    leftX: number
    rightX: number
    bottomY: number
  }) => void
  hideCoachmark: () => void
}

interface UseCentralPillCoachmarkOpts {
  bridge: CoachmarkBridge | undefined
  /** The dashboard already IS the picker, so the hint is pointless there. */
  isInstallLess: Ref<boolean>
  /** The pill is non-interactive mid-bootstrap, so don't point at it. */
  isFirstUseLockdown: Ref<boolean>
  /** Wait out a ProgressModal takeover so the hint fires over real ComfyUI, not the loader. */
  isLoadingLockdown?: Ref<boolean>
  /** Whether this hint currently owns the window's single coachmark popup. Retiring hides that
   *  popup, and by the time the pill drawer opens the hint has usually never been on it (it is
   *  once-ever, and having been seen is exactly what lets another card through) — so without
   *  this check, acknowledging the hint would hide someone else's card. Defaults to "owns it",
   *  preserving the original behaviour for callers that do not share the popup. */
  ownsPopup?: () => boolean
  installPillRef: Readonly<ShallowRef<HTMLElement | null>>
  /** Resolved coachmark copy (i18n done by the caller). */
  title: string
  body: string
  dismissLabel: string
}

interface CentralPillCoachmarkApi {
  /** Evaluate the gate and show the coachmark once if it passes. */
  maybeShow: () => Promise<void>
  /** Persist the seen flag and hide. Idempotent. */
  dismiss: () => Promise<void>
  /** Opening the pill drawer counts as acknowledgement; same as `dismiss`. */
  acknowledgeViaPillOpen: () => Promise<void>
  /** The popup was hidden by something other than a retirement (the host window moved).
   *  Clears display state without persisting `seen`, so the hint can be raised again. */
  forgetWithoutAcknowledging: () => void
  /** `true` between show and dismiss; drives the pill highlight. */
  isShowing: Ref<boolean>
}

/**
 * First-instance coachmark pointing at the central pill, shown once ever. Owns the
 * gate, persistence, anchoring, and dismiss wiring; the visual lives in the main-side
 * popup, so this stays unit-testable without a WebContentsView.
 */
export function useCentralPillCoachmark(
  opts: UseCentralPillCoachmarkOpts
): CentralPillCoachmarkApi {
  const isShowing = ref(false)
  // Session guards so show/dismiss stick before the async `setSetting` round-trips.
  let hasCoachmarkShown = false
  let hasCoachmarkRetired = false

  async function isSeen(): Promise<boolean> {
    if (hasCoachmarkRetired) return true
    try {
      const v = await (window.api.getSetting(CENTRAL_PILL_HINT_SEEN_KEY) as Promise<
        boolean | undefined
      >)
      return v === true
    } catch {
      // Read failed; treat as unseen so the hint still gets a chance.
      return false
    }
  }

  function gatePasses(): boolean {
    return (
      !opts.isInstallLess.value && !opts.isFirstUseLockdown.value && !opts.isLoadingLockdown?.value
    )
  }

  async function maybeShow(): Promise<void> {
    if (!opts.bridge) return
    if (hasCoachmarkShown || hasCoachmarkRetired) return
    if (!gatePasses() || !opts.installPillRef.value) return
    if (await isSeen()) return
    // Re-check after the async read; the host could have flipped state while awaiting.
    const pill = opts.installPillRef.value
    if (!gatePasses() || !pill) return

    const rect = pill.getBoundingClientRect()
    hasCoachmarkShown = true
    isShowing.value = true
    opts.bridge.showCoachmark({
      title: opts.title,
      body: opts.body,
      dismissLabel: opts.dismissLabel,
      leftX: Math.round(rect.left),
      rightX: Math.round(rect.right),
      bottomY: Math.round(rect.bottom)
    })
  }

  /** The popup was pulled out from under this hint by something that is not a retirement —
   *  main auto-hides it when the host window moves or resizes. Clears the display state
   *  WITHOUT persisting `seen`, and releases the once-per-renderer show latch so the hint can
   *  be raised again: the user may never have read it.
   *
   *  Leaving this unhandled strands more than the hint. `isShowing` is the beta notice's
   *  suppression gate, so a hint stuck "showing" with no popup on screen silences the beta
   *  card for the rest of the renderer's life, and cannot itself be dismissed — there is no
   *  card left to click. */
  function forgetWithoutAcknowledging(): void {
    if (hasCoachmarkRetired) return
    isShowing.value = false
    hasCoachmarkShown = false
  }

  async function retire(): Promise<void> {
    const owned = opts.ownsPopup?.() ?? true
    isShowing.value = false
    if (hasCoachmarkRetired) return
    hasCoachmarkRetired = true
    // Only pull down the popup if this hint is what is on it.
    if (owned) opts.bridge?.hideCoachmark()
    try {
      await window.api.setSetting(CENTRAL_PILL_HINT_SEEN_KEY, true)
    } catch {
      // Persistence failed; a future launch re-offers the hint.
    }
  }

  return {
    maybeShow,
    dismiss: retire,
    acknowledgeViaPillOpen: retire,
    forgetWithoutAcknowledging,
    isShowing
  }
}
