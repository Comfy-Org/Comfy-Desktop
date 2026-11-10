import { ref, type Ref, type ShallowRef } from 'vue'

export const CENTRAL_PILL_HINT_SEEN_KEY = 'hasSeenCentralPillHint'

interface CoachmarkBridge {
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
  isInstallLess: Ref<boolean>
  isFirstUseLockdown: Ref<boolean>
  isLoadingLockdown?: Ref<boolean>
  ownsPopup?: () => boolean
  installPillRef: Readonly<ShallowRef<HTMLElement | null>>
  title: string
  body: string
  dismissLabel: string
}

interface CentralPillCoachmarkApi {
  maybeShow: () => Promise<void>
  dismiss: () => Promise<void>
  acknowledgeViaPillOpen: () => Promise<void>
  forgetWithoutAcknowledging: () => void
  isShowing: Ref<boolean>
}

export function useCentralPillCoachmark(
  opts: UseCentralPillCoachmarkOpts
): CentralPillCoachmarkApi {
  const isShowing = ref(false)
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
    if (owned) opts.bridge?.hideCoachmark()
    try {
      await window.api.setSetting(CENTRAL_PILL_HINT_SEEN_KEY, true)
    } catch {}
  }

  return {
    maybeShow,
    dismiss: retire,
    acknowledgeViaPillOpen: retire,
    forgetWithoutAcknowledging,
    isShowing
  }
}
