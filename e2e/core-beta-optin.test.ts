
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

const BETA_LABEL = 'Opt-in to beta features'
const BETA_SWITCH = `.global-settings button[role="switch"][aria-label="${BETA_LABEL}"]`
const NEEDS_TELEMETRY_TOOLTIP =
  'Beta features require confirming data sharing in Settings, even if telemetry is currently on.'

interface BetaRowState {
  ariaDisabled: string | null
  ariaChecked: string | null
  title: string | null
  describedText: string | null
}

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

async function openDesktopSettings(ctx: AppContext, popup: WebContentsPage): Promise<void> {
  await closeTitlePopupIfOpen(ctx.app)
  await new Promise((resolve) => setTimeout(resolve, TITLE_REOPEN_SUPPRESSION_MS))
  await openTitleMenu(ctx.titleBar)
  await popup.waitForVisible('[role="menuitem"]', { timeout: 10_000 })
  expect(await popup.clickByText('[role="menuitem"]', 'Desktop Settings')).toBe(true)
  await popup.waitForVisible('.global-settings', { timeout: 10_000 })
  await popup.waitForVisible(BETA_SWITCH, { timeout: 10_000 })
}

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
    await new Promise((resolve) => setTimeout(resolve, 300))
    const state = await readBetaRow(popup())
    expect(state!.ariaChecked).toBe('false')
    expect(state!.ariaDisabled).toBe('true')
  })

  test('the blocked beta opt-in row explains why via its tooltip @windows @macos @linux', async () => {
    const state = await readBetaRow(popup())
    expect(state!.title).not.toBeNull()
    expect(state!.title!.trim().length).toBeGreaterThan(0)
    expect(state!.title).not.toBe('tooltips.betaFeaturesNeedTelemetry')
    expect(state!.title).toBe(NEEDS_TELEMETRY_TOOLTIP)
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
