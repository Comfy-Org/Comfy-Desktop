import { ref, shallowRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBetaActivationNotice } from './useBetaActivationNotice'

/**
 * The card's copy is resolved by the caller, and WHEN it is resolved is load-bearing.
 *
 * The title bar's i18n instance starts in English and `syncLocale()` only runs on mount, so
 * copy read during setup is an English snapshot that never updates — the wrong language for a
 * user whose persisted locale is not English, and permanently wrong for every later card in
 * that renderer. These pin the contract that the getters are called when the card is built.
 */
describe('useBetaActivationNotice copy resolution', () => {
  let showCoachmark: ReturnType<typeof vi.fn>

  /** Enough of a host for the gate to pass and a card to be built. */
  function mountNotice(copy: () => string) {
    showCoachmark = vi.fn()
    const anchor = document.createElement('button')
    anchor.getBoundingClientRect = () => ({ left: 10, right: 30, bottom: 40 }) as unknown as DOMRect

    return useBetaActivationNotice({
      bridge: { showCoachmark, hideCoachmark: vi.fn() },
      installationId: () => 'inst-1',
      isInstallLess: ref(false),
      isFirstUseLockdown: ref(false),
      isLoadingLockdown: ref(false),
      anchorRef: shallowRef(anchor),
      isSuppressed: () => false,
      copyFor: () => ({
        title: copy(),
        body: copy(),
        dismissLabel: copy(),
        actionLabel: copy()
      })
    })
  }

  beforeEach(() => {
    ;(window as unknown as { api: unknown }).api = {
      getPendingBetaNotice: vi.fn().mockResolvedValue({
        args: ['--enable-assets'],
        direction: 'enabled',
        description: null
      }),
      acknowledgeBetaNotice: vi.fn().mockResolvedValue(undefined),
      openGlobalSettings: vi.fn()
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as { api?: unknown }).api
  })

  it('resolves copy when the card is shown, not when the composable is created', async () => {
    // Stands in for the i18n instance: English at setup, switched by `syncLocale()` on mount.
    let translated = 'english-copy'
    const notice = mountNotice(() => translated)

    translated = 'localised-copy'
    await notice.maybeShow()

    expect(showCoachmark).toHaveBeenCalledTimes(1)
    const payload = showCoachmark.mock.calls[0]![0]
    expect(payload.title).toBe('localised-copy')
    expect(payload.body).toBe('localised-copy')
    expect(payload.dismissLabel).toBe('localised-copy')
    expect(payload.actionLabel).toBe('localised-copy')
  })

  it('re-reads copy for each card, so a later activation follows a live language change', async () => {
    let translated = 'first-language'
    const notice = mountNotice(() => translated)

    await notice.maybeShow()
    expect(showCoachmark.mock.calls[0]![0].title).toBe('first-language')

    // The user switches language, then a second grant clears its version gate.
    translated = 'second-language'
    notice.forgetWithoutAcknowledging()
    ;(window.api.getPendingBetaNotice as ReturnType<typeof vi.fn>).mockResolvedValue({
      args: ['--enable-something-else'],
      direction: 'enabled',
      description: null
    })
    await notice.maybeShow()

    expect(showCoachmark).toHaveBeenCalledTimes(2)
    expect(showCoachmark.mock.calls[1]![0].title).toBe('second-language')
  })
})
