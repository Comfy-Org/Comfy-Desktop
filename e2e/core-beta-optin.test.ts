/**
 * Beta-features opt-in consent gate — title-popup Global Settings.
 *
 * The opt-in is one-way gated: turning it ON requires explicit telemetry
 * consent, turning it OFF never does. The gate is derived renderer-side in
 * `GlobalSettingsView.vue` (`turnOnDisabled: !snapshot.telemetryGranted`) and
 * rendered by `BooleanToggle.vue`, which keys the blocked state on
 * `aria-disabled` rather than the native `disabled` attribute so the control
 * stays focusable. These assertions therefore read the ARIA state, not the
 * dimming CSS class that rides along with it.
 *
 * Consent is seeded pre-launch (`SeedOptions.settings`) because
 * `telemetryGranted` is computed once per snapshot from persisted settings, so
 * each state needs its own app instance rather than in-test mutation.
 */

import { expect, test } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { openTitleMenu } from './support/chooserHelpers'
import {
  closeTitlePopupIfOpen,
  titlePopupPage,
  TITLE_REOPEN_SUPPRESSION_MS,
  type WebContentsPage,
} from './support/cdpPages'

test.describe.configure({ mode: 'serial' })

/** `settings.betaFeaturesEnabled` in locales/en.json — also the switch's
 *  `aria-label`, since `BooleanToggle` labels itself from `field.label`. */
const BETA_LABEL = 'Opt in to beta features'
const BETA_SWITCH = `.global-settings button[role="switch"][aria-label="${BETA_LABEL}"]`
/** `tooltips.betaFeaturesNeedTelemetry` in locales/en.json. */
const NEEDS_TELEMETRY_TOOLTIP =
  'Beta features require confirming data sharing in Settings, even if telemetry is currently on.'

interface BetaRowState {
  /** `null` when the attribute is absent; Vue renders `"false"` when enabled. */
  ariaDisabled: string | null
  ariaChecked: string | null
  /** `null` when unblocked — the tooltip binding resolves to `undefined`. */
  title: string | null
  /** Text of the element `aria-describedby` points at, if any. */
  describedText: string | null
}

/**
 * Read the beta switch's semantic state in one round trip. Attributes are read
 * with `getAttribute` (not `.disabled` / `.checked`) because the component sets
 * ARIA state on a plain `<button>`, where the DOM properties do not exist.
 */
async function readBetaRow(popup: WebContentsPage): Promise<BetaRowState | null> {
  return popup.evaluate<BetaRowState | null>(`(() => {
    const el = document.querySelector(${JSON.stringify(BETA_SWITCH)})
    if (!el) return null
    const describedBy = el.getAttribute('aria-describedby')
    const description = describedBy ? document.getElementById(describedBy) : null
    return {
      ariaDisabled: el.getAttribute('aria-disabled'),
      ariaChecked: el.getAttribute('aria-checked'),
      title: el.getAttribute('title'),
      describedText: description ? (description.textContent || '').trim() : null,
    }
  })()`)
}

/** Walk the real UI to the Privacy section: title menu -> Desktop Settings ->
 *  General tab (the default landing tab). Closes any open popup first so the
 *  walk is identical whichever test ran before it. */
async function openDesktopSettings(ctx: AppContext, popup: WebContentsPage): Promise<void> {
  await closeTitlePopupIfOpen(ctx.app)
  await new Promise((resolve) => setTimeout(resolve, TITLE_REOPEN_SUPPRESSION_MS))
  await openTitleMenu(ctx.titleBar)
  await popup.waitForVisible('[role="menuitem"]', { timeout: 10_000 })
  expect(await popup.clickByText('[role="menuitem"]', 'Desktop Settings')).toBe(true)
  await popup.waitForVisible('.global-settings', { timeout: 10_000 })
  await popup.waitForVisible(BETA_SWITCH, { timeout: 10_000 })
}

/** Launch an app instance seeded with a given consent/opt-in pair, bound to
 *  the enclosing describe block. */
function betaScenario(settings: Record<string, unknown>): () => WebContentsPage {
  let ctx: AppContext
  let popup: WebContentsPage

  test.beforeAll(async () => {
    ctx = await launchApp({ settings: { firstUseCompleted: true, ...settings } })
    popup = titlePopupPage(ctx.app)
  })

  test.beforeEach(async () => {
    await openDesktopSettings(ctx, popup)
  })

  test.afterAll(async () => {
    await ctx?.cleanup()
  })

  return () => popup
}

test.describe('telemetry consent not granted', () => {
  const popup = betaScenario({ telemetryEnabled: false, betaFeaturesEnabled: false })

  test('the beta opt-in row is disabled while consent is withheld @windows @macos @linux', async () => {
    const state = await readBetaRow(popup())
    expect(state, 'beta opt-in switch missing from Global Settings').not.toBeNull()
    expect(state!.ariaDisabled).toBe('true')
    expect(state!.ariaChecked).toBe('false')
  })

  test('clicking the blocked beta opt-in row does not turn it on @windows @macos @linux', async () => {
    expect(await popup().click(BETA_SWITCH)).toBe(true)
    // The handler bails synchronously, but allow a frame for a mistaken state
    // flip to land before asserting it did not.
    await new Promise((resolve) => setTimeout(resolve, 300))
    const state = await readBetaRow(popup())
    expect(state!.ariaChecked).toBe('false')
    expect(state!.ariaDisabled).toBe('true')
  })

  test('the blocked beta opt-in row explains why via its tooltip @windows @macos @linux', async () => {
    const state = await readBetaRow(popup())
    // Present and non-empty: an absent or blank `title` leaves the user with a
    // dimmed control and no stated reason.
    expect(state!.title).not.toBeNull()
    expect(state!.title!.trim().length).toBeGreaterThan(0)
    // Resolved copy, not the raw key — catches a missing translation entry,
    // which would still be "present and non-empty".
    expect(state!.title).not.toBe('tooltips.betaFeaturesNeedTelemetry')
    expect(state!.title).toBe(NEEDS_TELEMETRY_TOOLTIP)
    // `title` is mouse-only, so the same reason must reach the a11y tree.
    expect(state!.describedText).toBe(NEEDS_TELEMETRY_TOOLTIP)
  })
})

test.describe('telemetry consent granted, opt-in off', () => {
  const popup = betaScenario({ telemetryEnabled: true, betaFeaturesEnabled: false })

  test('the beta opt-in row is enabled and off once consent is granted @windows @macos @linux', async () => {
    const state = await readBetaRow(popup())
    expect(state, 'beta opt-in switch missing from Global Settings').not.toBeNull()
    expect(state!.ariaDisabled).toBe('false')
    expect(state!.ariaChecked).toBe('false')
    // Unblocked rows carry no explanatory tooltip at all.
    expect(state!.title).toBeNull()
  })
})

test.describe('telemetry consent granted, opt-in on', () => {
  const popup = betaScenario({ telemetryEnabled: true, betaFeaturesEnabled: true })

  test('the beta opt-in row is enabled and on when opted in @windows @macos @linux', async () => {
    const state = await readBetaRow(popup())
    expect(state, 'beta opt-in switch missing from Global Settings').not.toBeNull()
    expect(state!.ariaDisabled).toBe('false')
    expect(state!.ariaChecked).toBe('true')
    expect(state!.title).toBeNull()
  })
})
